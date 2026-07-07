import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { safeLocalArtifactPath, verifyArtifactDownloadSignature } from "../../../../../../../../lib/artifact-downloads.js";

export const runtime = "nodejs";

type DownloadRouteProps = {
  params: Promise<{ runId: string; artifactId: string }>;
};

type QueryResult = {
  rows?: readonly Record<string, unknown>[];
};

type ArtifactRow = {
  id: string;
  runId: string;
  kind: string;
  name: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  role: string;
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
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

async function lookupArtifact(runId: string, artifactId: string): Promise<ArtifactRow | undefined> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return undefined;
  }

  const executor = createPgQueryExecutor({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
  const result = await executor.query(
    `select id, run_id, kind, name, storage_path, sha256, bytes, role
     from artifacts
     where id = $1 and run_id = $2`,
    [artifactId, runId],
  );
  const row = rows(result)[0];

  if (!row) {
    return undefined;
  }

  return {
    id: stringValue(row, "id") ?? "",
    runId: stringValue(row, "run_id") ?? "",
    kind: stringValue(row, "kind") ?? "artifact",
    name: stringValue(row, "name") ?? "artifact",
    storagePath: stringValue(row, "storage_path") ?? "",
    sha256: stringValue(row, "sha256") ?? "",
    bytes: numberValue(row, "bytes") ?? 0,
    role: stringValue(row, "role") ?? "download",
  };
}

function attachmentName(name: string): string {
  return path.basename(name).replace(/[\r\n"]/g, "_") || "artifact";
}

export async function GET(request: Request, { params }: DownloadRouteProps): Promise<Response> {
  const { runId, artifactId } = await params;
  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";

  if (!Number.isInteger(expiresAt) || !signature) {
    return Response.json({ ok: false, error: "signed artifact URL is required" }, { status: 401 });
  }

  if (!verifyArtifactDownloadSignature({ runId, artifactId, expiresAt, signature })) {
    return Response.json({ ok: false, error: "artifact URL is invalid or expired" }, { status: 403 });
  }

  const artifact = await lookupArtifact(runId, artifactId);

  if (!artifact) {
    return Response.json({ ok: false, error: "artifact not found" }, { status: 404 });
  }

  const driver = process.env.ARTIFACT_STORAGE_DRIVER ?? "local";

  if (driver !== "local") {
    return Response.json({ ok: false, error: `artifact storage driver '${driver}' is not supported by this route` }, { status: 501 });
  }

  const storageRoot = process.env.ARTIFACT_STORAGE_ROOT;

  if (!storageRoot) {
    return Response.json({ ok: false, error: "artifact storage root is not configured" }, { status: 503 });
  }

  const artifactPath = safeLocalArtifactPath(storageRoot, artifact.storagePath);

  if (!artifactPath) {
    return Response.json({ ok: false, error: "artifact path is outside the storage root" }, { status: 403 });
  }

  const fileStat = await stat(artifactPath).catch(() => undefined);

  if (!fileStat?.isFile()) {
    return Response.json({ ok: false, error: "artifact file is not available" }, { status: 404 });
  }

  const data = await readFile(artifactPath);

  return new Response(data, {
    headers: {
      "content-disposition": `attachment; filename="${attachmentName(artifact.name)}"`,
      "content-length": String(data.byteLength),
      "content-type": "application/octet-stream",
      "x-boardreadyops-artifact-id": artifact.id,
      "x-boardreadyops-artifact-kind": artifact.kind,
      "x-boardreadyops-artifact-role": artifact.role,
      "x-boardreadyops-artifact-sha256": artifact.sha256,
    },
  });
}
