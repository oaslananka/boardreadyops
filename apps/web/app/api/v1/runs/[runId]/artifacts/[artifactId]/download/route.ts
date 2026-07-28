import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  artifactAttachmentHeader,
  configuredArtifactDownloadSigningKey,
  resolveLocalArtifactFile,
  verifyArtifactDownloadSignature,
} from "../../../../../../../../lib/artifact-downloads.js";

export const runtime = "nodejs";

type DownloadRouteProps = {
  params: Promise<{ runId: string; artifactId: string }>;
};

export type ArtifactDownloadRecord = {
  id: string;
  runId: string;
  installationId: string;
  repositoryId: string;
  kind: string;
  name: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  role: string;
};

export type ArtifactDownloadQueryExecutor = {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
};

export type ArtifactDownloadLookupResult =
  | { state: "not-configured" }
  | { state: "not-found" }
  | { state: "found"; artifact: ArtifactDownloadRecord };

export type ArtifactDownloadRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  lookupArtifact(runId: string, artifactId: string): Promise<ArtifactDownloadLookupResult>;
  recordDownloadStarted(artifact: ArtifactDownloadRecord): Promise<void>;
  now(): number;
};

export type ArtifactDownloadRouteFactories = {
  createQueryExecutor(options: { connectionString: string; max: number }): ArtifactDownloadQueryExecutor;
};

const defaultFactories: ArtifactDownloadRouteFactories = {
  createQueryExecutor: createPgQueryExecutor,
};

type QueryResult = {
  rows?: readonly Record<string, unknown>[];
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }

  const value = (result as QueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export async function lookupArtifactDownload(
  runId: string,
  artifactId: string,
  executor: ArtifactDownloadQueryExecutor,
): Promise<ArtifactDownloadLookupResult> {
  const result = await executor.query(
    `select artifact.id,
            artifact.run_id,
            repository.installation_id,
            repository.id as repository_id,
            artifact.kind,
            artifact.name,
            artifact.storage_path,
            artifact.sha256,
            artifact.bytes,
            artifact.role
       from artifacts as artifact
       join release_runs as release_run on release_run.id = artifact.run_id
       join repositories as repository on repository.id = release_run.repository_id
      where artifact.id = $1 and artifact.run_id = $2`,
    [artifactId, runId],
  );
  const row = rows(result)[0];

  if (!row) {
    return { state: "not-found" };
  }

  return {
    state: "found",
    artifact: {
      id: stringValue(row, "id") ?? "",
      runId: stringValue(row, "run_id") ?? "",
      installationId: stringValue(row, "installation_id") ?? "",
      repositoryId: stringValue(row, "repository_id") ?? "",
      kind: stringValue(row, "kind") ?? "artifact",
      name: stringValue(row, "name") ?? "artifact",
      storagePath: stringValue(row, "storage_path") ?? "",
      sha256: stringValue(row, "sha256") ?? "",
      bytes: numberValue(row, "bytes") ?? 0,
      role: stringValue(row, "role") ?? "download",
    },
  };
}

export async function recordArtifactDownloadStarted(
  artifact: ArtifactDownloadRecord,
  executor: ArtifactDownloadQueryExecutor,
): Promise<void> {
  await executor.query(
    `insert into audit_events (
       installation_id, event_type, actor_type, subject_type, subject_id,
       repository_id, release_run_id, artifact_id, metadata
     ) values (
       $1, 'artifact.download.started', 'signed_url', 'artifact', $4,
       $2, $3, $4, $5::jsonb
     )`,
    [
      artifact.installationId,
      artifact.repositoryId,
      artifact.runId,
      artifact.id,
      JSON.stringify({
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        itemType: artifact.kind,
        scope: artifact.role,
      }),
    ],
  );
}

export function createArtifactDownloadRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  factories: ArtifactDownloadRouteFactories = defaultFactories,
): ArtifactDownloadRouteDependencies {
  let executor: ArtifactDownloadQueryExecutor | undefined;
  const queryExecutor = (): ArtifactDownloadQueryExecutor | undefined => {
    const connectionString = environment.DATABASE_URL;
    if (!connectionString) return undefined;
    executor ??= factories.createQueryExecutor({
      connectionString,
      max: Number(environment.DATABASE_POOL_MAX ?? 5),
    });
    return executor;
  };

  return {
    environment,
    now: Date.now,
    async lookupArtifact(runId, artifactId) {
      const configuredExecutor = queryExecutor();
      if (!configuredExecutor) return { state: "not-configured" };
      return await lookupArtifactDownload(runId, artifactId, configuredExecutor);
    },
    async recordDownloadStarted(artifact) {
      const configuredExecutor = queryExecutor();
      if (!configuredExecutor) throw new Error("artifact metadata store is not configured");
      await recordArtifactDownloadStarted(artifact, configuredExecutor);
    },
  };
}

function safeHeaderValue(input: string): string {
  return [...input]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? "_" : character;
    })
    .join("")
    .slice(0, 256);
}

function jsonError(error: string, status: number): Response {
  return Response.json(
    { ok: false, error },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function handleArtifactDownloadRequest(
  request: Request,
  params: { runId: string; artifactId: string },
  dependencies: ArtifactDownloadRouteDependencies = createArtifactDownloadRouteDependencies(),
): Promise<Response> {
  const { runId, artifactId } = params;
  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";
  const signingKey = configuredArtifactDownloadSigningKey(dependencies.environment);

  if (!Number.isSafeInteger(expiresAt) || !signature) {
    return jsonError("signed artifact URL is required", 401);
  }

  if (!verifyArtifactDownloadSignature({ runId, artifactId, expiresAt, signature }, signingKey, dependencies.now())) {
    return jsonError("artifact URL is invalid or expired", 403);
  }

  let lookup: ArtifactDownloadLookupResult;
  try {
    lookup = await dependencies.lookupArtifact(runId, artifactId);
  } catch {
    return jsonError("artifact metadata is temporarily unavailable", 503);
  }
  if (lookup.state === "not-configured") {
    return jsonError("artifact metadata store is not configured", 503);
  }
  if (lookup.state === "not-found") {
    return jsonError("artifact not found", 404);
  }

  const driver = dependencies.environment.ARTIFACT_STORAGE_DRIVER ?? "local";
  if (driver !== "local") {
    return jsonError("artifact storage driver is not supported by this route", 501);
  }

  const storageRoot = dependencies.environment.ARTIFACT_STORAGE_ROOT;
  if (!storageRoot) {
    return jsonError("artifact storage root is not configured", 503);
  }

  const resolution = await resolveLocalArtifactFile(storageRoot, lookup.artifact.storagePath);
  if (resolution.state === "outside-root") {
    return jsonError("artifact path is outside the storage root", 403);
  }
  if (resolution.state === "storage-unavailable") {
    return jsonError("artifact storage is not available", 503);
  }
  if (resolution.state === "file-unavailable") {
    return jsonError("artifact file is not available", 404);
  }

  const fileHandle = await open(resolution.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    () => undefined,
  );
  if (!fileHandle) {
    return jsonError("artifact file is not available", 404);
  }

  const fileStat = await fileHandle.stat().catch(() => undefined);
  if (!fileStat?.isFile()) {
    await fileHandle.close();
    return jsonError("artifact file is not available", 404);
  }

  if (fileStat.size !== lookup.artifact.bytes) {
    await fileHandle.close();
    return jsonError("artifact metadata does not match the stored file", 409);
  }

  try {
    await dependencies.recordDownloadStarted(lookup.artifact);
  } catch {
    await fileHandle.close().catch(() => undefined);
    return jsonError("artifact access audit is temporarily unavailable", 503);
  }

  const nodeStream = fileHandle.createReadStream({ autoClose: true });
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new Response(body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": artifactAttachmentHeader(lookup.artifact.name),
      "content-length": String(fileStat.size),
      "content-type": "application/octet-stream",
      "x-boardreadyops-artifact-id": safeHeaderValue(lookup.artifact.id),
      "x-boardreadyops-artifact-kind": safeHeaderValue(lookup.artifact.kind),
      "x-boardreadyops-artifact-role": safeHeaderValue(lookup.artifact.role),
      "x-boardreadyops-artifact-sha256": safeHeaderValue(lookup.artifact.sha256),
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(request: Request, { params }: DownloadRouteProps): Promise<Response> {
  return await handleArtifactDownloadRequest(request, await params);
}
