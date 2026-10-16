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
    const rows = (result as { rows?: SnapshotRow[] }).rows ?? [];
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
  } finally {
    await executor.close();
  }
}
