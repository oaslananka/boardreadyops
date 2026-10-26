import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PcbFootprintSummary } from "../../packages/contracts/src/pcb-footprint-summary.js";
import {
  loadRunPcbFootprintSummary,
  storeRunPcbFootprintSummary,
} from "../../packages/db/src/pcb-footprint-summary-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = randomUUID();
const repositoryId = randomUUID();
const headRunId = randomUUID();
const wrongHeadRunId = randomUUID();
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const wrongHeadSha = "c".repeat(40);
const summary: PcbFootprintSummary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: baseSha,
  headCommitSha: headSha,
  baseBlobSha: "d".repeat(40),
  headBlobSha: "e".repeat(40),
  baseSourceSha256: "f".repeat(64),
  headSourceSha256: "1".repeat(64),
  changes: {
    added: 1,
    removed: 0,
    modified: 1,
    byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 1, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
};

function database() {
  if (!executor) throw new Error("A disposable PostgreSQL test database is required");
  return executor;
}

describeDatabase("opted-in PCB footprint evidence with real PostgreSQL", () => {
  beforeAll(async () => {
    await database().query(
      `insert into installations(id, github_installation_id, account_login, account_type)
       values ($1, $2, 'footprint-test', 'Organization')`,
      [installationId, randomInt(1_000_000_000) + 1_000_000_000],
    );
    await database().query(
      `insert into repositories(id, installation_id, github_repo_id, owner, name, default_branch, private)
       values ($1, $2, $3, 'footprint-test', 'private-board', 'main', true)`,
      [repositoryId, installationId, randomInt(1_000_000_000) + 2_000_000_000],
    );
    await database().query(
      `insert into release_runs(id, repository_id, commit_sha, ref, trigger_kind)
       values ($1, $2, $3, 'refs/heads/main', 'manual'),
              ($4, $2, $5, 'refs/heads/main', 'manual')`,
      [headRunId, repositoryId, headSha, wrongHeadRunId, wrongHeadSha],
    );
  });

  afterAll(async () => {
    try {
      await database().query("delete from release_runs where id in ($1, $2)", [headRunId, wrongHeadRunId]);
      await database().query("delete from repositories where id = $1", [repositoryId]);
      await database().query("delete from installations where id = $1", [installationId]);
    } finally {
      await executor?.close();
    }
  });

  it("refuses claims for the wrong repository or wrong committed head without inserting a row", async () => {
    await expect(storeRunPcbFootprintSummary(database(), randomUUID(), headRunId, summary)).rejects.toThrow(
      "binding failed",
    );
    await expect(storeRunPcbFootprintSummary(database(), repositoryId, wrongHeadRunId, summary)).rejects.toThrow(
      "binding failed",
    );
    const result = (await database().query(
      "select count(*)::int as count from run_pcb_footprint_summaries where run_id in ($1, $2)",
      [headRunId, wrongHeadRunId],
    )) as { rows: { count: number }[] };
    expect(result.rows[0]?.count).toBe(0);
  });

  it("persists only versioned count-only evidence for the exact run and repository", async () => {
    await storeRunPcbFootprintSummary(database(), repositoryId, headRunId, summary);
    const rows = (await database().query(
      `select repository_id, base_commit_sha, head_commit_sha, summary, summary_sha256
       from run_pcb_footprint_summaries where run_id = $1`,
      [headRunId],
    )) as { rows: Record<string, unknown>[] };
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      repository_id: repositoryId,
      base_commit_sha: baseSha,
      head_commit_sha: headSha,
      summary,
    });
    const disclosure = JSON.stringify(rows.rows[0]);
    expect(disclosure).not.toContain("sourceUuid");
    expect(disclosure).not.toContain('positionMm":{"x"');
    expect(disclosure).not.toContain("(kicad_pcb");
  });

  it("reads only exact repository/run/base/head and fails closed on a modified storage digest", async () => {
    expect(await loadRunPcbFootprintSummary(database(), repositoryId, headRunId, baseSha, headSha)).toEqual(summary);
    expect(await loadRunPcbFootprintSummary(database(), randomUUID(), headRunId, baseSha, headSha)).toBeUndefined();
    expect(
      await loadRunPcbFootprintSummary(database(), repositoryId, wrongHeadRunId, baseSha, headSha),
    ).toBeUndefined();
    expect(
      await loadRunPcbFootprintSummary(database(), repositoryId, headRunId, wrongHeadSha, headSha),
    ).toBeUndefined();
    expect(
      await loadRunPcbFootprintSummary(database(), repositoryId, headRunId, baseSha, wrongHeadSha),
    ).toBeUndefined();
    await database().query("update run_pcb_footprint_summaries set summary_sha256 = $2 where run_id = $1", [
      headRunId,
      "0".repeat(64),
    ]);
    expect(await loadRunPcbFootprintSummary(database(), repositoryId, headRunId, baseSha, headSha)).toBeUndefined();
  });

  it("cascades the evidence out of storage when the run is deleted", async () => {
    await database().query("delete from release_runs where id = $1", [headRunId]);
    const rows = (await database().query("select run_id from run_pcb_footprint_summaries where run_id = $1", [
      headRunId,
    ])) as { rows: { run_id: string }[] };
    expect(rows.rows).toEqual([]);
  });
});
