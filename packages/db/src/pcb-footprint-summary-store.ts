import { createHash } from "node:crypto";
import { pcbFootprintSummarySchema } from "@boardreadyops/contracts/pcb-footprint-summary";
import type { z } from "zod";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

type Summary = z.infer<typeof pcbFootprintSummarySchema>;

/** Caller must already authenticate and authorize this repository's write scope. */
export async function storeRunPcbFootprintSummary(
  db: SqlQueryExecutor,
  repositoryId: string,
  runId: string,
  summary: Summary,
): Promise<void> {
  const encoded = JSON.stringify(pcbFootprintSummarySchema.parse(summary));
  const digest = createHash("sha256").update(encoded, "utf8").digest("hex");
  // Binding to the owning run/repository and its committed revision is enforced in SQL.
  // This is client-reported evidence, never independent server-side source verification.
  const result = await db.query(
    `insert into run_pcb_footprint_summaries
       (run_id, repository_id, base_commit_sha, head_commit_sha, summary_sha256, summary)
     select id, repository_id, $3, $4, $5, $6::jsonb
     from release_runs where id = $1 and repository_id = $2 and commit_sha = $4
     returning run_id`,
    [runId, repositoryId, summary.baseCommitSha, summary.headCommitSha, digest, encoded],
  );
  const rows = (result as { rows?: { run_id: string }[] }).rows ?? [];
  if (rows.length !== 1 || rows[0]?.run_id !== runId) {
    throw new Error("PCB summary run/commit binding failed");
  }
}

/** Read only after the canonical review-viewer authorization has passed. */
export async function loadRunPcbFootprintSummary(
  db: SqlQueryExecutor,
  repositoryId: string,
  runId: string,
  baseCommitSha: string | null,
  headCommitSha: string,
): Promise<Summary | undefined> {
  if (!baseCommitSha) return undefined;
  const result = await db.query(
    `select summary, summary_sha256 from run_pcb_footprint_summaries
     where run_id = $1 and repository_id = $2 and base_commit_sha = $3 and head_commit_sha = $4
     limit 1`,
    [runId, repositoryId, baseCommitSha, headCommitSha],
  );
  const rows = (result as { rows?: { summary: unknown; summary_sha256: string }[] }).rows ?? [];
  const row = rows[0];
  if (!row) return undefined;
  let value: unknown;
  try {
    value = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary;
  } catch {
    return undefined;
  }
  const parsed = pcbFootprintSummarySchema.safeParse(value);
  if (!parsed.success) return undefined;
  const digest = createHash("sha256").update(JSON.stringify(parsed.data), "utf8").digest("hex");
  return digest === row.summary_sha256 &&
    parsed.data.baseCommitSha === baseCommitSha &&
    parsed.data.headCommitSha === headCommitSha
    ? parsed.data
    : undefined;
}
