import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import {
  runnerArtifactCapabilityRequestSchema,
  runnerArtifactCapabilityResponseSchema,
} from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlRunnerArtifactStore, type RunnerArtifactStore } from "@boardreadyops/db/runner-artifact-store";
import { safeLocalArtifactPath } from "./artifact-downloads.js";
import { authenticateRunnerRequest } from "./runner-request-auth.js";

const maximumCapabilityRequestBytes = 64 * 1024;
const artifactIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const uploadTokenPattern = /^[A-Za-z0-9_-]{43,256}$/u;

export type RunnerArtifactRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  queryExecutor(): SqlQueryExecutor | undefined;
  createArtifactStore(executor: SqlQueryExecutor): RunnerArtifactStore;
  now(): Date;
};

type ParsedBody = { ok: true; text: string; value: unknown } | { ok: false; response: Response };

type LocalArtifactTarget = {
  finalPath: string;
  temporaryPath: string;
};

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function configuredQueryExecutor(
  environment: Readonly<Record<string, string | undefined>>,
): SqlQueryExecutor | undefined {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return undefined;
  return createPgQueryExecutor({
    connectionString,
    max: Number(environment.DATABASE_POOL_MAX ?? 5),
  });
}

function defaultDependencies(): RunnerArtifactRouteDependencies {
  const environment = process.env;
  return {
    environment,
    queryExecutor: () => configuredQueryExecutor(environment),
    createArtifactStore: (executor) => createSqlRunnerArtifactStore(executor),
    now: () => new Date(),
  };
}

async function parseJsonBody(request: Request): Promise<ParsedBody> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/u.test(contentLength) && Number(contentLength) > maximumCapabilityRequestBytes) {
    return { ok: false, response: jsonResponse({ ok: false, error: "runner request payload is too large" }, 413) };
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumCapabilityRequestBytes) {
    return { ok: false, response: jsonResponse({ ok: false, error: "runner request payload is too large" }, 413) };
  }

  try {
    return { ok: true, text, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonResponse({ ok: false, error: "invalid runner request JSON" }, 400) };
  }
}

function publicUploadUrl(
  environment: Readonly<Record<string, string | undefined>>,
  artifactId: string,
  uploadToken: string,
): string | undefined {
  const baseUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return undefined;

  try {
    const url = new URL(`/api/v1/runner/artifacts/${encodeURIComponent(artifactId)}/upload`, baseUrl);
    if (url.protocol !== "https:") return undefined;
    url.searchParams.set("cap", uploadToken);
    return url.toString();
  } catch {
    return undefined;
  }
}

function hasHttpsPublicBaseUrl(environment: Readonly<Record<string, string | undefined>>): boolean {
  const baseUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function localArtifactTarget(storageRoot: string, storagePath: string): Promise<LocalArtifactTarget | undefined> {
  const lexicalPath = safeLocalArtifactPath(storageRoot, storagePath);
  if (!lexicalPath) return undefined;

  const root = await realpath(path.resolve(storageRoot)).catch(() => undefined);
  if (!root) return undefined;

  const lexicalParent = path.dirname(lexicalPath);
  await mkdir(lexicalParent, { recursive: true, mode: 0o700 });
  const parent = await realpath(lexicalParent).catch(() => undefined);
  if (!parent || !isInside(root, parent)) return undefined;

  const finalPath = path.join(parent, path.basename(lexicalPath));
  if (!isInside(root, finalPath)) return undefined;
  return {
    finalPath,
    temporaryPath: `${finalPath}.${randomUUID()}.uploading`,
  };
}

async function removeFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  await unlink(filePath).catch(() => undefined);
}

async function writeRequestBody(input: {
  request: Request;
  temporaryPath: string;
  maximumBytes: number;
}): Promise<{ ok: true; bytes: number; sha256: string } | { ok: false; reason: string; status: number }> {
  const declaredLength = input.request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || String(Number(declaredLength)) !== declaredLength) {
      return { ok: false, reason: "artifact content length is invalid", status: 400 };
    }
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > input.maximumBytes) {
      return { ok: false, reason: "artifact payload exceeds its declared size", status: 413 };
    }
    if (parsedLength !== input.maximumBytes) {
      return { ok: false, reason: "artifact payload size does not match its declaration", status: 409 };
    }
  }

  const file = await open(input.temporaryPath, "wx", 0o600).catch(() => undefined);
  if (!file) return { ok: false, reason: "artifact storage is unavailable", status: 503 };

  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const reader = input.request.body?.getReader();
    if (reader) {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > input.maximumBytes) {
          await reader.cancel("artifact payload exceeds its declared size").catch(() => undefined);
          return { ok: false, reason: "artifact payload exceeds its declared size", status: 413 };
        }
        hash.update(item.value);
        let offset = 0;
        while (offset < item.value.byteLength) {
          const write = await file.write(item.value, offset, item.value.byteLength - offset);
          if (write.bytesWritten <= 0) throw new Error("artifact write made no progress");
          offset += write.bytesWritten;
        }
      }
    }
    await file.sync();
  } catch {
    return { ok: false, reason: "artifact upload stream failed", status: 400 };
  } finally {
    await file.close().catch(() => undefined);
  }

  if (bytes !== input.maximumBytes) {
    return { ok: false, reason: "artifact payload size does not match its declaration", status: 409 };
  }
  return { ok: true, bytes, sha256: hash.digest("hex") };
}

export async function handleRunnerArtifactCapabilityRequest(
  request: Request,
  dependencies: RunnerArtifactRouteDependencies = defaultDependencies(),
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = runnerArtifactCapabilityRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid artifact capability request" }, 400);
  }

  const executor = dependencies.queryExecutor();
  if (!executor) return jsonResponse({ ok: false, error: "artifact capability service is unavailable" }, 503);

  const authenticated = await authenticateRunnerRequest({
    request,
    body: body.text,
    executor,
    now: dependencies.now(),
    context: {
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
    },
  });
  if (!authenticated) {
    return jsonResponse({ ok: false, error: "invalid runner request authentication" }, 401);
  }
  if (!hasHttpsPublicBaseUrl(dependencies.environment)) {
    return jsonResponse({ ok: false, error: "HTTPS public URL is not configured" }, 503);
  }

  try {
    const result = await dependencies.createArtifactStore(executor).issueCapabilities({
      ...authenticated.identity,
      requestTimestamp: authenticated.envelope.timestamp,
      requestNonce: authenticated.envelope.nonce,
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
      leaseToken: parsed.data.leaseToken,
      artifacts: parsed.data.artifacts.map((artifact) => ({
        kind: artifact.kind,
        name: artifact.name,
        role: artifact.role,
        bytes: artifact.bytes,
        ...(artifact.sha256 === undefined ? {} : { sha256: artifact.sha256 }),
      })),
    });
    if (result.status !== "accepted") {
      return result.status === "replayed"
        ? jsonResponse({ ok: false, error: "artifact capability request was replayed" }, 409)
        : jsonResponse({ ok: false, error: "runner lease is stale" }, 409);
    }

    const uploads = result.uploads.map((upload) => {
      const uploadUrl = publicUploadUrl(dependencies.environment, upload.artifactId, upload.uploadToken);
      if (!uploadUrl) throw new Error("HTTPS public URL is not configured");
      return {
        artifactId: upload.artifactId,
        uploadUrl,
        expiresAt: upload.expiresAt,
        maximumBytes: upload.maximumBytes,
      };
    });
    return jsonResponse(
      runnerArtifactCapabilityResponseSchema.parse({
        protocolVersion: 1,
        uploads,
      }),
    );
  } catch {
    return jsonResponse({ ok: false, error: "artifact capability service is unavailable" }, 503);
  }
}

export async function handleRunnerArtifactUploadRequest(
  request: Request,
  artifactId: string,
  dependencies: RunnerArtifactRouteDependencies = defaultDependencies(),
): Promise<Response> {
  const uploadToken = new URL(request.url).searchParams.get("cap") ?? "";
  if (!artifactIdPattern.test(artifactId) || !uploadTokenPattern.test(uploadToken)) {
    return jsonResponse({ ok: false, error: "valid artifact upload capability is required" }, 401);
  }
  if ((dependencies.environment.ARTIFACT_STORAGE_DRIVER ?? "local") !== "local") {
    return jsonResponse({ ok: false, error: "artifact storage driver is not supported" }, 501);
  }
  const storageRoot = dependencies.environment.ARTIFACT_STORAGE_ROOT;
  if (!storageRoot) {
    return jsonResponse({ ok: false, error: "artifact storage root is not configured" }, 503);
  }

  const executor = dependencies.queryExecutor();
  if (!executor) return jsonResponse({ ok: false, error: "artifact upload service is unavailable" }, 503);
  const store = dependencies.createArtifactStore(executor);

  const begun = await store.beginUpload({ artifactId, uploadToken }).catch(() => undefined);
  if (!begun) return jsonResponse({ ok: false, error: "artifact upload service is unavailable" }, 503);
  if (begun.status !== "accepted") {
    if (begun.status === "expired") {
      return jsonResponse({ ok: false, error: "artifact upload capability expired" }, 410);
    }
    return begun.status === "replayed"
      ? jsonResponse({ ok: false, error: "artifact upload capability was already used" }, 409)
      : jsonResponse({ ok: false, error: "artifact upload capability is invalid" }, 403);
  }

  const target = await localArtifactTarget(storageRoot, begun.storagePath);
  if (!target) {
    await Promise.resolve(
      store.failUpload({ artifactId, uploadToken, reason: "Artifact storage path is unavailable." }),
    ).catch(() => undefined);
    return jsonResponse({ ok: false, error: "artifact storage path is unavailable" }, 503);
  }

  const written = await writeRequestBody({
    request,
    temporaryPath: target.temporaryPath,
    maximumBytes: begun.declaredBytes,
  });
  if (!written.ok) {
    await removeFile(target.temporaryPath);
    await Promise.resolve(store.failUpload({ artifactId, uploadToken, reason: written.reason })).catch(() => undefined);
    return jsonResponse({ ok: false, error: written.reason }, written.status);
  }

  if (begun.expectedSha256 !== undefined && begun.expectedSha256 !== written.sha256) {
    await removeFile(target.temporaryPath);
    await Promise.resolve(
      store.failUpload({ artifactId, uploadToken, reason: "Artifact SHA-256 does not match its declaration." }),
    ).catch(() => undefined);
    return jsonResponse({ ok: false, error: "artifact SHA-256 does not match its declaration" }, 409);
  }

  try {
    await link(target.temporaryPath, target.finalPath);
    await removeFile(target.temporaryPath);
  } catch {
    await removeFile(target.temporaryPath);
    await Promise.resolve(
      store.failUpload({ artifactId, uploadToken, reason: "Artifact destination already exists or is unavailable." }),
    ).catch(() => undefined);
    return jsonResponse({ ok: false, error: "artifact destination is unavailable" }, 409);
  }

  const completed = await store
    .completeUpload({ artifactId, uploadToken, sha256: written.sha256, bytes: written.bytes })
    .catch(() => undefined);
  if (!completed) {
    await removeFile(target.finalPath);
    await Promise.resolve(
      store.failUpload({ artifactId, uploadToken, reason: "Artifact metadata persistence failed." }),
    ).catch(() => undefined);
    return jsonResponse({ ok: false, error: "artifact upload service is unavailable" }, 503);
  }
  if (completed.status !== "accepted" && completed.status !== "replayed") {
    await removeFile(target.finalPath);
    const status = completed.status === "expired" ? 410 : completed.status === "rejected" ? 409 : 403;
    return jsonResponse({ ok: false, error: `artifact upload was ${completed.status}` }, status);
  }

  return jsonResponse(
    {
      protocolVersion: 1,
      status: "accepted",
      artifactId,
      bytes: written.bytes,
      sha256: written.sha256,
    },
    201,
  );
}
