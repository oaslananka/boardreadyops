import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { PcbFootprintSummary } from "../../../packages/contracts/src/pcb-footprint-summary.js";
import {
  loadRunPcbFootprintSummary,
  storeRunPcbFootprintSummary,
} from "../../../packages/db/src/pcb-footprint-summary-store.js";

const summary: PcbFootprintSummary = {
  schemaVersion: 1,
  scope: "pcb-footprints-only",
  provenance: "local-git-commits",
  disclosure: "counts-and-digests-only",
  baseCommitSha: "a".repeat(40),
  headCommitSha: "b".repeat(40),
  baseBlobSha: "c".repeat(40),
  headBlobSha: "d".repeat(40),
  baseSourceSha256: "e".repeat(64),
  headSourceSha256: "f".repeat(64),
  changes: {
    added: 0,
    removed: 0,
    modified: 1,
    byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 1, rotationDeg: 0 },
  },
  riskAssessment: "not-evaluated",
};
const digest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");

describe("repository/run/commit-scoped PCB summary store", () => {
  it("persists only the validated summary when the owning repository+run+commit match", async () => {
    const query = vi.fn(async (_sql: string, params: unknown[]) => ({ rows: [{ run_id: params[0] }] }));
    await storeRunPcbFootprintSummary({ query }, "repo-a", "run-1", summary);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("from release_runs where id = $1 and repository_id = $2 and commit_sha = $4");
    expect(sql).toContain("returning run_id");
    expect(params.slice(0, 5)).toEqual(["run-1", "repo-a", summary.baseCommitSha, summary.headCommitSha, digest]);
    expect(JSON.parse(params[5] as string)).toEqual(summary);
  });

  it("rejects storage when no authoritative run matches", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(storeRunPcbFootprintSummary({ query }, "wrong-repo", "run-1", summary)).rejects.toThrow(
      "binding failed",
    );
  });

  it("loads only an intact and matching summary for the authorized review's current revision", async () => {
    const query = vi.fn(async () => ({ rows: [{ summary, summary_sha256: digest }] }));
    expect(
      await loadRunPcbFootprintSummary({ query }, "repo-a", "run-1", summary.baseCommitSha, summary.headCommitSha),
    ).toEqual(summary);
    expect((query.mock.calls[0] as unknown as [string, unknown[]])?.[1]).toEqual([
      "run-1",
      "repo-a",
      summary.baseCommitSha,
      summary.headCommitSha,
    ]);
    expect(await loadRunPcbFootprintSummary({ query }, "repo-a", "run-1", null, summary.headCommitSha)).toBeUndefined();
  });

  it("fails closed if stored bytes change, source commit mismatches or schema is malformed", async () => {
    const row = (content: unknown, hash: string) => ({ rows: [{ summary: content, summary_sha256: hash }] });
    const tampered = vi.fn(async () => row(summary, "0".repeat(64)));
    expect(
      await loadRunPcbFootprintSummary({ query: tampered }, "r", "run", summary.baseCommitSha, summary.headCommitSha),
    ).toBeUndefined();
    const other = vi.fn(async () => row({ ...summary, headCommitSha: "9".repeat(40) }, digest));
    expect(
      await loadRunPcbFootprintSummary({ query: other }, "r", "run", summary.baseCommitSha, summary.headCommitSha),
    ).toBeUndefined();
    const hostile = vi.fn(async () => row({ ...summary, sourceText: "private" }, digest));
    expect(
      await loadRunPcbFootprintSummary({ query: hostile }, "r", "run", summary.baseCommitSha, summary.headCommitSha),
    ).toBeUndefined();
  });
});

describe("additive PCB-summary PostgreSQL migration", () => {
  it("cascades with its owning run/repository and stores no raw PCB geometry", async () => {
    const sql = await readFile(
      new URL("../../../packages/db/migrations/0094_run_pcb_footprint_summaries.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("/* tsqllint-disable set-quoted-identifier */");
    expect(sql).toContain("run_id text primary key references release_runs(id) on delete cascade");
    expect(sql).toContain("repository_id text not null references repositories(id) on delete cascade");
    expect(sql).toContain("summary_sha256 text not null");
    expect(sql).toContain("summary jsonb not null");
    expect(sql).not.toContain("ALTER TABLE release_runs");
  });
});
