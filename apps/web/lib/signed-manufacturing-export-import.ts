import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import { copyFile, mkdir, open, realpath, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { verifyReviewedExportAttestation } from "../../../src/release/export-attestation.js";
import { safeLocalArtifactPath } from "./artifact-downloads.js";
import type { VerifiedGitHubActionsOidcClaims } from "./github-actions-oidc.js";
import type { ResultOidcExpectations } from "./result-oidc-expectations.js";

const execFileAsync = promisify(execFile);
const maximumArchiveBytes = 128 * 1024 * 1024;
const maximumArchiveEntries = 1100;
const manifestPath = "build/boardreadyops-attested/manifest.json";
const bundlePath = "bundle.sigstore.json";
const allowedExportRoot = "build/boardreadyops-attested/";

export type SignedExportImportDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  queryExecutor(): SqlQueryExecutor | undefined;
  closeQueryExecutor?(executor: SqlQueryExecutor): Promise<void>;
  loadExpectedRun(
    executor: SqlQueryExecutor,
    runId: string,
    attemptId: string,
  ): Promise<ResultOidcExpectations | undefined>;
  verifyOidc(token: string, expected: ResultOidcExpectations): Promise<VerifiedGitHubActionsOidcClaims | undefined>;
  verifyArchive(input: {
    root: string;
    manifestPath: string;
    bundlePath: string;
    expected: {
      repository: string;
      repositoryId: string;
      reviewedSha: string;
      signerSha: string;
      sourceRef: string;
      workflowPath: string;
      event: string;
      runId: string;
      runAttempt: number;
    };
  }): Promise<{ status: "eligible" | "rejected"; reason: string; subjects?: number }>;
  now(): Date;
  id(): string;
};

function signedManufacturingExportAudience(
  expected: Pick<ResultOidcExpectations, "runId" | "executionAttemptId" | "targetSha">,
): string {
  if (!expected.executionAttemptId) throw new Error("signed manufacturing export requires an execution attempt");
  return ["boardreadyops-manufacturing-export", expected.runId, expected.executionAttemptId, expected.targetSha].join(
    ":",
  );
}

function jsonError(error: string, status: number): Response {
  return Response.json(
    { ok: false, error },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  const match = authorization === null ? null : /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  return match?.[1];
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function safeArchiveEntry(name: string): boolean {
  if (!name || name.length > 1024 || name.startsWith("/") || name.includes("\\") || /[\r\n\0]/u.test(name))
    return false;
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  return normalized.split("/").every((piece) => piece.length > 0 && piece !== "." && piece !== "..");
}

async function writeRequestArchive(
  request: Request,
  target: string,
): Promise<{ bytes: number; sha256: string } | undefined> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumArchiveBytes)) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const file = await open(target, "wx", 0o600).catch(() => undefined);
  if (!file) return undefined;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximumArchiveBytes) {
        await reader.cancel("signed export archive too large").catch(() => undefined);
        return undefined;
      }
      hash.update(item.value);
      let offset = 0;
      while (offset < item.value.byteLength) {
        const result = await file.write(item.value, offset, item.value.byteLength - offset);
        if (result.bytesWritten <= 0) throw new Error("archive write made no progress");
        offset += result.bytesWritten;
      }
    }
    if (bytes === 0) return undefined;
    await file.sync();
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function fileDigest(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

// Windows tar emits CRLF listing separators. Normalize only the line terminator;
// embedded carriage returns must remain visible to the entry-name guard.
export function tarListingLines(output: string): string[] {
  return output.split(/\r?\n/u).filter(Boolean);
}

export function tarEntryExpandedBytes(detail: string): number | undefined {
  const gnu = /^[-d][rwxStTs-]{9}\s+\S+\s+(\d+)\s/u.exec(detail);
  const bsd = /^[-d][rwxStTs-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s/u.exec(detail);
  const match = gnu ?? bsd;
  if (!match) return undefined;
  const size = Number(match[1]);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function safeArchiveHeaders(details: string[]): boolean {
  let expandedBytes = 0;
  for (const detail of details) {
    const size = tarEntryExpandedBytes(detail);
    if (size === undefined) return false;
    expandedBytes += size;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > 512 * 1024 * 1024) return false;
  }
  return true;
}

function safeArchiveNames(entries: string[], details: string[]): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const name = entries[index];
    const detail = details[index];
    if (!name || !detail || !safeArchiveEntry(name) || seen.has(name)) return false;
    seen.add(name);
    const type = detail[0];
    if (type !== "-" && type !== "d") return false;
    const isRoot =
      name === "build/" || name === "build" || name === allowedExportRoot || name === allowedExportRoot.slice(0, -1);
    if (name !== bundlePath && !isRoot && !name.startsWith(allowedExportRoot)) return false;
  }
  return seen.has(bundlePath) && seen.has(manifestPath);
}

async function inspectTar(archive: string): Promise<boolean> {
  try {
    const [names, verbose] = await Promise.all([
      execFileAsync("tar", ["-tzf", archive], { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 }),
      execFileAsync("tar", ["-tvzf", archive], { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 }),
    ]);
    const entries = tarListingLines(names.stdout);
    const details = tarListingLines(verbose.stdout);
    if (entries.length < 2 || entries.length > maximumArchiveEntries || entries.length !== details.length) return false;
    return safeArchiveHeaders(details) && safeArchiveNames(entries, details);
  } catch {
    return false;
  }
}

function configuredQueryExecutor(
  environment: Readonly<Record<string, string | undefined>>,
): SqlQueryExecutor | undefined {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return undefined;
  return createPgQueryExecutor({ connectionString, max: Number(environment.DATABASE_POOL_MAX ?? 5) });
}

function createSignedExportImportDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SignedExportImportDependencies {
  return {
    environment,
    queryExecutor: () => configuredQueryExecutor(environment),
    closeQueryExecutor: async (executor) => {
      if ("close" in executor && typeof executor.close === "function") await executor.close();
    },
    loadExpectedRun: async (executor, runId, attemptId) => {
      const { resultOidcExpectations } = await import("./result-oidc-expectations.js");
      return await resultOidcExpectations(executor, runId, attemptId, { requireActiveAttempt: true });
    },
    verifyOidc: async (token, expected) => {
      const { verifyGitHubActionsOidcTokenClaims } = await import("./github-actions-oidc.js");
      return await verifyGitHubActionsOidcTokenClaims(token, {
        ...expected,
        audience: signedManufacturingExportAudience(expected),
        runAttempt: 1,
      });
    },
    verifyArchive: async (input) =>
      await verifyReviewedExportAttestation({
        root: input.root,
        manifestPath: input.manifestPath,
        bundlePath: input.bundlePath,
        sourceCheckout: false,
        expected: input.expected,
      }),
    now: () => new Date(),
    id: randomUUID,
  };
}

type AuthenticatedExport = {
  expected: ResultOidcExpectations;
  claims: VerifiedGitHubActionsOidcClaims;
};

async function authenticateExportRequest(
  request: Request,
  params: { runId: string; attemptId: string },
  dependencies: SignedExportImportDependencies,
  executor: SqlQueryExecutor,
): Promise<AuthenticatedExport | Response> {
  let expected: ResultOidcExpectations | undefined;
  try {
    expected = await dependencies.loadExpectedRun(executor, params.runId, params.attemptId);
  } catch {
    return jsonError("signed export authorization is temporarily unavailable", 503);
  }
  if (!expected?.executionAttemptId || expected.executionAttemptId !== params.attemptId) {
    return jsonError("run or execution attempt is not eligible for a signed export", 409);
  }

  let claims: VerifiedGitHubActionsOidcClaims | undefined;
  try {
    claims = await dependencies.verifyOidc(bearerToken(request) ?? "", expected);
  } catch {
    claims = undefined;
  }
  const validClaims =
    claims &&
    claims.workflowRunId === expected.githubRunId &&
    claims.runAttempt === 1 &&
    Boolean(claims.workflowSha) &&
    claims.repository === expected.repository &&
    claims.repositoryId === expected.repositoryId &&
    claims.workflowRef === expected.workflowRef &&
    claims.ref === expected.ref &&
    claims.event === "workflow_dispatch" &&
    claims.runnerEnvironment === "github-hosted";
  if (!validClaims || !claims) return jsonError("invalid GitHub Actions OIDC authentication", 401);
  return { expected, claims };
}

function archiveVerificationInput(
  extractionRoot: string,
  expected: ResultOidcExpectations,
  claims: VerifiedGitHubActionsOidcClaims,
) {
  return {
    root: extractionRoot,
    manifestPath,
    bundlePath: path.join(extractionRoot, bundlePath),
    expected: {
      repository: expected.repository,
      repositoryId: expected.repositoryId,
      reviewedSha: expected.targetSha,
      signerSha: claims.workflowSha,
      sourceRef: expected.ref,
      workflowPath: expected.workflowPath,
      event: "workflow_dispatch",
      runId: expected.githubRunId,
      runAttempt: 1,
    },
  };
}

async function recordVerifiedExport(
  executor: SqlQueryExecutor,
  params: { runId: string; attemptId: string },
  dependencies: SignedExportImportDependencies,
  expected: ResultOidcExpectations,
  claims: VerifiedGitHubActionsOidcClaims,
  artifact: { id: string; name: string; sha256: string; bytes: number },
  manifestBytes: Buffer,
  bundleBytes: Buffer,
  subjects: number,
): Promise<"accepted" | "replayed" | "stale"> {
  const sql =
    "select public.boardreadyops_record_signed_manufacturing_export(" +
    "$1::timestamptz, $2, $3, $4, $5, $6, $7::integer, $8, $9, $10::bigint, " +
    "$11, $12::integer, $13, $14, $15, $16, $17::integer) as outcome";
  const result = await executor.query(sql, [
    dependencies.now().toISOString(),
    params.runId,
    params.attemptId,
    artifact.id,
    artifact.name,
    artifact.sha256,
    artifact.bytes,
    expected.targetSha,
    claims.workflowSha,
    expected.repositoryId,
    expected.githubRunId,
    1,
    expected.ref,
    expected.workflowPath,
    createHash("sha256").update(manifestBytes).digest("hex"),
    createHash("sha256").update(bundleBytes).digest("hex"),
    subjects,
  ]);
  const rows =
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: Record<string, unknown>[] }).rows
      : [];
  const outcome = rows[0]?.outcome;
  if (outcome === "accepted" || outcome === "replayed") return outcome;
  return "stale";
}

async function persistVerifiedArchive(
  extractionRoot: string,
  archive: { bytes: number; sha256: string },
  params: { runId: string; attemptId: string },
  dependencies: SignedExportImportDependencies,
  executor: SqlQueryExecutor,
  expected: ResultOidcExpectations,
  claims: VerifiedGitHubActionsOidcClaims,
  subjects: number,
): Promise<Response> {
  const artifactId = dependencies.id();
  if (!uuid(artifactId)) return jsonError("signed export metadata service is unavailable", 503);
  const archiveName = path.posix.join(params.runId, params.attemptId, `${artifactId}.tar.gz`);
  const storageRoot = dependencies.environment.ARTIFACT_STORAGE_ROOT;
  if (!storageRoot) return jsonError("manufacturing artifact storage is not configured", 503);
  const finalPath = safeLocalArtifactPath(storageRoot, archiveName);
  if (!finalPath) return jsonError("artifact storage path is invalid", 503);

  let ownsFinalPath = false;
  let databaseWriteMayHaveCommitted = false;
  try {
    const storageRealRoot = await mkdir(path.resolve(storageRoot), { recursive: true, mode: 0o700 })
      .then(() => realpath(path.resolve(storageRoot)))
      .catch(() => undefined);
    if (!storageRealRoot) return jsonError("artifact storage is unavailable", 503);
    await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    const realParent = await realpath(path.dirname(finalPath)).catch(() => undefined);
    if (!realParent?.startsWith(storageRealRoot + path.sep)) return jsonError("artifact storage path is invalid", 503);

    await copyFile(path.join(path.dirname(extractionRoot), "upload.tar.gz"), finalPath, fsConstants.COPYFILE_EXCL);
    ownsFinalPath = true;
    const stored = await stat(finalPath);
    if (stored.size !== archive.bytes || (await fileDigest(finalPath)) !== archive.sha256) {
      return jsonError("stored manufacturing export changed during ingestion", 503);
    }

    const fs = await import("node:fs/promises");
    const manifestBytes = await fs.readFile(path.join(extractionRoot, manifestPath));
    const bundleBytes = await fs.readFile(path.join(extractionRoot, bundlePath));
    databaseWriteMayHaveCommitted = true;
    const outcome = await recordVerifiedExport(
      executor,
      params,
      dependencies,
      expected,
      claims,
      { id: artifactId, name: archiveName, sha256: archive.sha256, bytes: archive.bytes },
      manifestBytes,
      bundleBytes,
      subjects,
    );
    if (outcome !== "accepted") {
      databaseWriteMayHaveCommitted = false;
      await unlink(finalPath).catch(() => undefined);
      ownsFinalPath = false;
      return outcome === "replayed"
        ? jsonError("a signed manufacturing export already exists for this run attempt", 409)
        : jsonError("the run attempt is no longer eligible for signed export ingestion", 409);
    }
    databaseWriteMayHaveCommitted = false;
    ownsFinalPath = false;
    return Response.json(
      { ok: true, artifactId, sha256: archive.sha256, bytes: archive.bytes, subjects },
      { status: 201, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    return jsonError("signed manufacturing export could not be ingested", 503);
  } finally {
    // Preserve bytes if a database transport failure leaves the commit outcome ambiguous.
    if (ownsFinalPath && !databaseWriteMayHaveCommitted) await unlink(finalPath).catch(() => undefined);
  }
}

async function importArchive(
  request: Request,
  params: { runId: string; attemptId: string },
  dependencies: SignedExportImportDependencies,
  executor: SqlQueryExecutor,
  expected: ResultOidcExpectations,
  claims: VerifiedGitHubActionsOidcClaims,
): Promise<Response> {
  const temporaryRoot = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "boardreadyops-signed-export-")),
  );
  const archivePath = path.join(temporaryRoot, "upload.tar.gz");
  const extractionRoot = path.join(temporaryRoot, "extracted");
  try {
    const archive = await writeRequestArchive(request, archivePath);
    if (!archive) return jsonError("signed export archive is empty, too large or unreadable", 413);
    if (!(await inspectTar(archivePath)))
      return jsonError("signed export archive contains unsafe or unsupported entries", 400);
    await mkdir(extractionRoot, { mode: 0o700 });
    await execFileAsync(
      "tar",
      ["--no-same-owner", "--no-same-permissions", "-xzf", archivePath, "-C", extractionRoot],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const verification = await dependencies.verifyArchive(archiveVerificationInput(extractionRoot, expected, claims));
    if (verification.status !== "eligible" || !verification.subjects) {
      return jsonError("signed manufacturing export could not be independently verified", 422);
    }
    return await persistVerifiedArchive(
      extractionRoot,
      archive,
      params,
      dependencies,
      executor,
      expected,
      claims,
      verification.subjects,
    );
  } catch {
    return jsonError("signed manufacturing export could not be ingested", 503);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function handleSignedManufacturingExportImport(
  request: Request,
  params: { runId: string; attemptId: string },
  dependencies: SignedExportImportDependencies = createSignedExportImportDependencies(),
): Promise<Response> {
  if (!uuid(params.runId) || !uuid(params.attemptId)) return jsonError("valid run and attempt IDs are required", 400);
  if (!bearerToken(request)) return jsonError("GitHub Actions OIDC authentication is required", 401);
  const contentType = request.headers.get("content-type")?.split(";")[0] ?? "";
  if (!["application/gzip", "application/x-gzip", "application/octet-stream"].includes(contentType)) {
    return jsonError("a gzip-compressed manufacturing export archive is required", 415);
  }

  let executor: SqlQueryExecutor | undefined;
  try {
    executor = dependencies.queryExecutor();
  } catch {
    return jsonError("signed export service is temporarily unavailable", 503);
  }
  if (!executor) return jsonError("signed export service is not configured", 503);

  try {
    const authentication = await authenticateExportRequest(request, params, dependencies, executor);
    if (authentication instanceof Response) return authentication;
    const { expected, claims } = authentication;
    if (
      !dependencies.environment.ARTIFACT_STORAGE_ROOT ||
      (dependencies.environment.ARTIFACT_STORAGE_DRIVER ?? "local") !== "local"
    ) {
      return jsonError("manufacturing artifact storage is not configured", 503);
    }
    return await importArchive(request, params, dependencies, executor, expected, claims);
  } catch {
    return jsonError("signed manufacturing export could not be ingested", 503);
  } finally {
    try {
      await dependencies.closeQueryExecutor?.(executor);
    } catch {
      // Pool cleanup must not replace the bounded request result.
    }
  }
}
