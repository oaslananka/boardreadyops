import { createHmac, timingSafeEqual } from "node:crypto";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { configuredArtifactDownloadSigningKey } from "./artifact-downloads.js";
import {
  createPrivateManufacturingObjectStore,
  verifiedManufacturingStoragePath,
} from "./private-manufacturing-object-store.js";
import {
  authenticateExportRequest,
  createSignedExportImportDependencies,
  importArchive,
  type SignedExportImportDependencies,
} from "./signed-manufacturing-export-import.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/u;
const maxArchiveBytes = 128 * 1024 * 1024;
const maxJsonBytes = 2048;
const ticketTtlSeconds = 600;

type TransferScope = { runId: string; attemptId: string };
type ObjectStore = Pick<
  ReturnType<typeof createPrivateManufacturingObjectStore>,
  "signPendingUpload" | "promotePending" | "getVerified" | "deletePending" | "deleteVerified"
>;
export type ManufacturingObjectTransferDependencies = SignedExportImportDependencies & {
  objectStore?: ObjectStore;
};

type TicketPayload = TransferScope & {
  uploadId: string;
  sha256: string;
  bytes: number;
  expiresAt: number;
};
type Prepare = { operation: "prepare"; sha256: string; bytes: number };
type Commit = {
  operation: "commit";
  uploadId: string;
  sha256: string;
  bytes: number;
  expiresAt: number;
  ticket: string;
};

function responseError(error: string, status: number): Response {
  return Response.json(
    { ok: false, error },
    {
      status,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    },
  );
}

function signTicket(input: TicketPayload, key: string | undefined): string | undefined {
  if (!key || Buffer.byteLength(key, "utf8") < 32) return undefined;
  const source = [
    "boardreadyops-manufacturing-s3-upload-v1",
    input.runId,
    input.attemptId,
    input.uploadId,
    input.sha256,
    String(input.bytes),
    String(input.expiresAt),
  ].join(":");
  return createHmac("sha256", key).update(source).digest("base64url");
}

function validTicket(input: TicketPayload, actual: string, key: string | undefined, now: Date): boolean {
  if (!signaturePattern.test(actual)) return false;
  const seconds = Math.floor(now.getTime() / 1000);
  if (
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt < seconds ||
    input.expiresAt > seconds + ticketTtlSeconds
  )
    return false;
  const expected = signTicket(input, key);
  if (!expected) return false;
  const left = Buffer.from(actual, "base64url");
  const right = Buffer.from(expected, "base64url");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function boundedJson(request: Request): Promise<unknown | Response> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return responseError("a JSON upload request is required", 415);
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && /^\d+$/u.test(lengthHeader) && Number(lengthHeader) > maxJsonBytes)
    return responseError("upload ticket request is too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return responseError("upload ticket request body is required", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxJsonBytes) {
        await reader.cancel("upload ticket request too large").catch(() => undefined);
        return responseError("upload ticket request is too large", 413);
      }
      chunks.push(part.value);
    }
    if (!size) return responseError("upload ticket request is empty", 400);
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return responseError("invalid upload ticket JSON", 400);
  } finally {
    reader.releaseLock();
  }
}

function parseBody(value: unknown): Prepare | Commit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (
    typeof body.sha256 !== "string" ||
    !sha256Pattern.test(body.sha256) ||
    typeof body.bytes !== "number" ||
    !Number.isSafeInteger(body.bytes) ||
    body.bytes < 1 ||
    body.bytes > maxArchiveBytes
  )
    return undefined;
  if (body.operation === "prepare") {
    if (Object.keys(body).some((key) => !["operation", "sha256", "bytes"].includes(key))) return undefined;
    return { operation: "prepare", sha256: body.sha256, bytes: body.bytes };
  }
  if (body.operation !== "commit") return undefined;
  if (
    Object.keys(body).some((key) => !["operation", "uploadId", "sha256", "bytes", "expiresAt", "ticket"].includes(key))
  )
    return undefined;
  if (
    typeof body.uploadId !== "string" ||
    !uuidPattern.test(body.uploadId) ||
    typeof body.expiresAt !== "number" ||
    !Number.isSafeInteger(body.expiresAt) ||
    typeof body.ticket !== "string"
  )
    return undefined;
  return {
    operation: "commit",
    uploadId: body.uploadId,
    sha256: body.sha256,
    bytes: body.bytes,
    expiresAt: body.expiresAt,
    ticket: body.ticket,
  };
}

async function prepareUpload(
  params: TransferScope,
  body: Prepare,
  dependencies: ManufacturingObjectTransferDependencies,
  store: ObjectStore,
  key: string,
): Promise<Response> {
  const uploadId = dependencies.id();
  if (!uuidPattern.test(uploadId)) return responseError("upload ticket service is unavailable", 503);
  const expiresAt = Math.floor(dependencies.now().getTime() / 1000) + ticketTtlSeconds;
  const ticket = signTicket({ ...params, uploadId, sha256: body.sha256, bytes: body.bytes, expiresAt }, key);
  if (!ticket) return responseError("upload ticket service is not configured", 503);
  try {
    const pending = await store.signPendingUpload({ ...params, uploadId, sha256: body.sha256, bytes: body.bytes });
    return Response.json(
      {
        ok: true,
        uploadUrl: pending.url,
        headers: pending.headers,
        uploadId,
        sha256: body.sha256,
        bytes: body.bytes,
        expiresAt,
        ticket,
      },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    return responseError("private manufacturing object upload is unavailable", 503);
  }
}

async function completeUpload(
  params: TransferScope,
  body: Commit,
  dependencies: ManufacturingObjectTransferDependencies,
  store: ObjectStore,
  key: string,
  executor: SqlQueryExecutor,
  expected: NonNullable<Awaited<ReturnType<SignedExportImportDependencies["loadExpectedRun"]>>>,
  claims: NonNullable<Awaited<ReturnType<SignedExportImportDependencies["verifyOidc"]>>>,
): Promise<Response> {
  if (
    !validTicket(
      { ...params, uploadId: body.uploadId, sha256: body.sha256, bytes: body.bytes, expiresAt: body.expiresAt },
      body.ticket,
      key,
      dependencies.now(),
    )
  )
    return responseError("manufacturing object upload ticket is invalid or expired", 403);
  const artifactId = dependencies.id();
  if (!uuidPattern.test(artifactId)) return responseError("verified object identity is invalid", 503);
  const promotion = { ...params, uploadId: body.uploadId, artifactId };
  const storagePath = verifiedManufacturingStoragePath(promotion);
  try {
    // The GitHub runner can only write to pending/. The privileged backend
    // copies into verified/ before checking actual bytes and Sigstore evidence.
    await store.promotePending(promotion);
  } catch {
    return responseError("private manufacturing object is not yet available", 503);
  }

  let result: Response;
  try {
    const object = await store.getVerified(storagePath);
    if (!object.body) throw new Error("verified object has no body");
    const streamed = new Request("https://boardreadyops.local/object-verification", {
      method: "POST",
      headers: { "content-type": "application/gzip" },
      body: object.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    result = await importArchive(streamed, params, dependencies, executor, expected, claims, undefined, {
      artifactId,
      storagePath,
      sha256: body.sha256,
      bytes: body.bytes,
    });
  } catch {
    await store.deleteVerified(storagePath).catch(() => undefined);
    return responseError("verified manufacturing object could not be read", 503);
  }

  if (result.status === 201) {
    // Cleanup failure cannot invalidate a committed, verified archive.
    await store.deletePending({ ...params, uploadId: body.uploadId }).catch(() => undefined);
  } else if ([400, 409, 413, 422].includes(result.status)) {
    // Only known-negative results allow a safe delete. An ambiguous DB 503
    // may have committed, so its verified bytes are always preserved.
    await store.deleteVerified(storagePath).catch(() => undefined);
  }
  return result;
}

/** Only a small OIDC-authenticated JSON ticket passes the web HTTP boundary. */
export async function handleManufacturingObjectTransfer(
  request: Request,
  params: TransferScope,
  dependencies: ManufacturingObjectTransferDependencies = createSignedExportImportDependencies(),
): Promise<Response> {
  if (!uuidPattern.test(params.runId) || !uuidPattern.test(params.attemptId))
    return responseError("valid run and attempt IDs are required", 400);
  if (dependencies.environment.BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE_ENABLED !== "true")
    return responseError("private object storage is disabled", 409);
  if (!/^Bearer [A-Za-z0-9._~-]+$/u.test(request.headers.get("authorization") ?? ""))
    return responseError("GitHub Actions OIDC authentication is required", 401);

  const parsed = await boundedJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parseBody(parsed);
  if (!body) return responseError("invalid bounded manufacturing object request", 400);
  const key = configuredArtifactDownloadSigningKey(dependencies.environment);
  if (!key || Buffer.byteLength(key, "utf8") < 32) return responseError("upload ticket service is not configured", 503);

  let store: ObjectStore;
  try {
    store = dependencies.objectStore ?? createPrivateManufacturingObjectStore(dependencies.environment);
  } catch {
    return responseError("private object storage is not configured", 503);
  }

  let executor: SqlQueryExecutor | undefined;
  try {
    executor = dependencies.queryExecutor();
    if (!executor) return responseError("signed export database is not configured", 503);
    const authenticated = await authenticateExportRequest(request, params, dependencies, executor);
    if (authenticated instanceof Response) return authenticated;
    if (body.operation === "prepare") return await prepareUpload(params, body, dependencies, store, key);
    return await completeUpload(
      params,
      body,
      dependencies,
      store,
      key,
      executor,
      authenticated.expected,
      authenticated.claims,
    );
  } catch {
    return responseError("private manufacturing object operation is temporarily unavailable", 503);
  } finally {
    if (executor && dependencies.closeQueryExecutor)
      await dependencies.closeQueryExecutor(executor).catch(() => undefined);
  }
}
