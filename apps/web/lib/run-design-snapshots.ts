import type { SnapshotArtifact } from "@boardreadyops/contracts";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";

type SnapshotRow = {
  snapshot_id: string;
  name: string;
  kind: SnapshotArtifact["kind"];
  format: SnapshotArtifact["format"];
  sheet_or_layer: string;
  width: number;
  height: number;
  content: string;
  sha256: string;
  anchors: SnapshotArtifact["anchors"] | string;
};

type Executor = { query(sql: string, params?: readonly unknown[]): Promise<unknown>; close(): Promise<void> };

function parseAnchors(raw: SnapshotRow["anchors"]): SnapshotArtifact["anchors"] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SnapshotArtifact["anchors"]) : [];
  } catch {
    return [];
  }
}

function toSnapshotArtifacts(rows: SnapshotRow[]): SnapshotArtifact[] {
  return rows.map((row) => ({
    id: row.snapshot_id,
    name: row.name,
    kind: row.kind,
    format: row.format,
    sheetOrLayer: row.sheet_or_layer,
    width: row.width,
    height: row.height,
    content: row.content,
    sha256: row.sha256,
    anchors: parseAnchors(row.anchors),
  }));
}

/** Called after an authorized run lookup, and independently bound to its repository ID. */
export async function loadRunDesignSnapshots(
  runId: string,
  repositoryId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  createExecutor: (options: { connectionString: string }) => Executor = createPgQueryExecutor,
): Promise<SnapshotArtifact[]> {
  if (!environment.DATABASE_URL) return [];
  const executor = createExecutor({ connectionString: environment.DATABASE_URL });
  try {
    const result = await executor.query(
      "SELECT s.snapshot_id, s.name, s.kind, s.format, s.sheet_or_layer, s.width, s.height, s.content, s.sha256, s.anchors FROM run_snapshots AS s JOIN release_runs AS r ON r.id = s.run_id WHERE r.id = $1 AND r.repository_id = $2 ORDER BY s.created_at ASC, s.snapshot_id ASC LIMIT 64",
      [runId, repositoryId],
    );
    return toSnapshotArtifacts((result as { rows?: SnapshotRow[] }).rows ?? []);
  } finally {
    await executor.close();
  }
}

/**
 * Best-effort base artwork for an already-authorized head run. Only the current
 * Review revision attached to that exact head run may name a base commit. The
 * baseline image must originate from one run in the same repository and exact
 * commit (not an arbitrary earlier run or another account's board).
 */
export async function loadRunDesignBaseSnapshots(
  headRunId: string,
  repositoryId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  createExecutor: (options: { connectionString: string }) => Executor = createPgQueryExecutor,
): Promise<SnapshotArtifact[]> {
  if (!environment.DATABASE_URL) return [];
  const executor = createExecutor({ connectionString: environment.DATABASE_URL });
  try {
    const result = await executor.query(
      `WITH current_review AS (
        SELECT revision.base_commit_sha
        FROM reviews AS review
        JOIN review_revisions AS revision
          ON revision.id = review.current_revision_id AND revision.review_id = review.id
        JOIN release_runs AS head
          ON head.id = review.head_run_id AND head.repository_id = review.repository_id
        WHERE review.head_run_id = $1 AND review.repository_id = $2
          AND revision.head_run_id = head.id AND revision.head_commit_sha = head.commit_sha
          AND revision.base_commit_sha IS NOT NULL
        ORDER BY review.updated_at DESC, review.id DESC
        LIMIT 1
      ), baseline AS (
        SELECT base.id
        FROM current_review AS revision
        JOIN release_runs AS base
          ON base.repository_id = $2 AND base.commit_sha = revision.base_commit_sha
        WHERE base.id <> $1
          AND EXISTS (SELECT 1 FROM run_snapshots AS available WHERE available.run_id = base.id)
        ORDER BY base.completed_at DESC NULLS LAST, base.started_at DESC, base.id DESC
        LIMIT 1
      )
      SELECT s.snapshot_id, s.name, s.kind, s.format, s.sheet_or_layer,
             s.width, s.height, s.content, s.sha256, s.anchors
      FROM run_snapshots AS s
      JOIN baseline ON baseline.id = s.run_id
      ORDER BY s.created_at ASC, s.snapshot_id ASC LIMIT 64`,
      [headRunId, repositoryId],
    );
    return toSnapshotArtifacts((result as { rows?: SnapshotRow[] }).rows ?? []);
  } finally {
    await executor.close();
  }
}
