import { createHash } from "node:crypto";
import type { SqlQueryExecutor } from "@boardreadyops/db";
import {
  type ArtifactDownloadRecord,
  recordArtifactDownloadStarted,
  streamVerifiedArtifactDownload,
} from "../app/api/v1/runs/[runId]/artifacts/[artifactId]/download/route.js";

/**
 * A guest token never authorizes an arbitrary URL. Resolve the exact archive
 * attached to the validated revision through a single tenant-bound SQL query.
 */
const guestManufacturingArchiveSql = [
  "select a.id, a.run_id, a.name, a.kind, a.role, a.storage_path,",
  "a.sha256, a.bytes, repository.id as repository_id, repository.installation_id",
  "from deliveries as delivery",
  "join revisions as revision on revision.id = delivery.revision_id",
  "join projects as project on project.id = revision.project_id",
  "join repositories as repository on",
  "lower(repository.owner || '/' || repository.name) = lower(project.github_repo_full_name)",
  "join release_runs as run on run.id = revision.validation_run_id",
  "and run.repository_id = repository.id and run.status = 'completed'",
  "and run.decision = 'pass' and run.completed_at is not null",
  "join artifacts as a on a.id = revision.validation_artifact_id and a.run_id = run.id",
  "and a.role = 'manufacturing' and a.kind = 'archive'",
  "and a.bytes > 0 and a.sha256 ~ '^[0-9a-f]{64}$'",
  "join manufacturing_share_authorizations as share",
  "on share.revision_id = revision.id and share.revoked_at is null",
  "and share.workspace_id = project.workspace_id",
  "and share.run_id = run.id and share.artifact_id = a.id",
  "and share.commit_sha = run.commit_sha and share.archive_sha256 = a.sha256",
  "where delivery.access_token_hash = $1 and delivery.expires_at > now()",
  "and revision.bundle_sha256 = a.sha256 and revision.commit_sha = run.commit_sha",
  "and project.github_repo_full_name is not null",
  "limit 1",
].join(" ");

const tokenPattern = /^[0-9a-f]{64}$/u;

function isArtifactRow(row: Record<string, unknown>): boolean {
  return (
    ["id", "run_id", "name", "kind", "role", "storage_path", "sha256", "repository_id", "installation_id"].every(
      (key) => typeof row[key] === "string" && (row[key] as string).length > 0,
    ) &&
    typeof row.bytes === "number" &&
    Number.isSafeInteger(row.bytes) &&
    row.bytes > 0 &&
    row.kind === "archive" &&
    row.role === "manufacturing" &&
    /^[0-9a-f]{64}$/u.test(String(row.sha256))
  );
}

export async function lookupGuestManufacturingArtifact(
  token: string,
  executor: SqlQueryExecutor,
): Promise<ArtifactDownloadRecord | null> {
  if (!tokenPattern.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const result = (await executor.query(guestManufacturingArchiveSql, [hash])) as {
    rows?: Record<string, unknown>[];
  };
  const row = result.rows?.[0];
  if (!row || !isArtifactRow(row)) return null;
  return {
    id: row.id as string,
    runId: row.run_id as string,
    installationId: row.installation_id as string,
    repositoryId: row.repository_id as string,
    kind: "archive",
    role: "manufacturing",
    name: row.name as string,
    storagePath: row.storage_path as string,
    sha256: row.sha256 as string,
    bytes: row.bytes as number,
  };
}

function unavailable(status: number): Response {
  return Response.json(
    { ok: false, error: status === 404 ? "Delivery not found or no longer eligible" : "Delivery storage unavailable" },
    { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } },
  );
}

export async function handleGuestManufacturingDownload(
  token: string,
  dependencies: {
    executor: SqlQueryExecutor;
    environment: Readonly<Record<string, string | undefined>>;
  },
): Promise<Response> {
  if (!tokenPattern.test(token)) return unavailable(404);
  let artifact: ArtifactDownloadRecord | null;
  try {
    artifact = await lookupGuestManufacturingArtifact(token, dependencies.executor);
  } catch {
    return unavailable(503);
  }
  if (!artifact) return unavailable(404);
  return await streamVerifiedArtifactDownload(artifact, {
    environment: dependencies.environment,
    recordDownloadStarted: async (record) => {
      await recordArtifactDownloadStarted(record, dependencies.executor, "guest_token");
    },
  });
}
