import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRunDesignBaseSnapshots } from "../../apps/web/lib/run-design-snapshots.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const database = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const describeDatabase = connectionString ? describe : describe.skip;
const installA = randomUUID();
const installB = randomUUID();
const repositoryA = randomUUID();
const repositoryB = randomUUID();
const headRun = randomUUID();
const baseRun = randomUUID();
const otherTenantRun = randomUUID();
const wrongCommitRun = randomUUID();
const reviewId = randomUUID();
const revisionId = randomUUID();
const headCommit = "a".repeat(40);
const baseCommit = "b".repeat(40);
const unrelatedCommit = "c".repeat(40);

async function sql(statement: string, parameters: unknown[]) {
  if (!database) throw new Error("PostgreSQL test database is not configured");
  return database.query(statement, parameters);
}

describeDatabase("authorized exact-commit run design base images (real PostgreSQL)", () => {
  beforeAll(async () => {
    await sql(
      `INSERT INTO installations(id, github_installation_id, account_login, account_type)
       VALUES ($1, 9711601, 'visual-design-a', 'Organization'),
              ($2, 9711602, 'visual-design-b', 'Organization')`,
      [installA, installB],
    );
    await sql(
      `INSERT INTO repositories(id, installation_id, github_repo_id, owner, name, default_branch, private)
       VALUES ($1, $2, 9711611, 'visual-design-a', 'sensor-board', 'main', true),
              ($3, $4, 9711612, 'visual-design-b', 'sensor-board', 'main', true)`,
      [repositoryA, installA, repositoryB, installB],
    );
    for (const [id, repository, sha] of [
      [headRun, repositoryA, headCommit],
      [baseRun, repositoryA, baseCommit],
      [otherTenantRun, repositoryB, baseCommit],
      [wrongCommitRun, repositoryA, unrelatedCommit],
    ]) {
      await sql(
        `INSERT INTO release_runs(id, repository_id, commit_sha, ref, trigger_kind, status, decision)
         VALUES ($1, $2, $3, 'refs/heads/main', 'manual', 'completed', 'pass')`,
        [id, repository, sha],
      );
    }
    for (const [id, run, name] of [
      [randomUUID(), baseRun, "correct-layer"],
      [randomUUID(), otherTenantRun, "other-tenant-layer"],
      [randomUUID(), wrongCommitRun, "wrong-commit-layer"],
    ]) {
      await sql(
        `INSERT INTO run_snapshots(id, run_id, snapshot_id, name, kind, format,
         sheet_or_layer, width, height, content, sha256, anchors)
         VALUES ($1, $2, $3, $3, 'pcb_layer', 'svg', 'F.Cu', 100, 100,
                 '<svg viewBox="0 0 100 100"></svg>', $4, '[]'::jsonb)`,
        [id, run, name, "d".repeat(64)],
      );
    }
    await sql(
      `INSERT INTO reviews(id, repository_id, pull_request_number, title, head_run_id, current_revision_id, created_by)
       VALUES ($1, $2, 99, 'Checked sensor board', $3, $4, 'fixture')`,
      [reviewId, repositoryA, headRun, revisionId],
    );
    await sql(
      `INSERT INTO review_revisions(id, review_id, sequence, head_run_id, base_commit_sha,
        head_commit_sha, evidence_digest)
       VALUES ($1, $2, 1, $3, $4, $5, $6)`,
      [revisionId, reviewId, headRun, baseCommit, headCommit, "e".repeat(64)],
    );
  });

  afterAll(async () => {
    try {
      await sql("DELETE FROM reviews WHERE id = $1", [reviewId]);
      await sql("DELETE FROM release_runs WHERE id = ANY($1::text[])", [
        [headRun, baseRun, otherTenantRun, wrongCommitRun],
      ]);
      await sql("DELETE FROM repositories WHERE id = ANY($1::text[])", [[repositoryA, repositoryB]]);
      await sql("DELETE FROM installations WHERE id = ANY($1::text[])", [[installA, installB]]);
    } finally {
      await database?.close();
    }
  });

  it("returns only the published exact base commit image within the authorized repository", async () => {
    const snapshots = await loadRunDesignBaseSnapshots(headRun, repositoryA, { DATABASE_URL: connectionString });
    expect(snapshots.map((item) => item.name)).toEqual(["correct-layer"]);
    expect(snapshots.map((item) => item.sheetOrLayer)).toEqual(["F.Cu"]);
  });

  it("returns no other tenant's images even if their base commit SHA matches", async () => {
    const snapshots = await loadRunDesignBaseSnapshots(headRun, repositoryB, { DATABASE_URL: connectionString });
    expect(snapshots).toEqual([]);
  });

  it("rejects a stale current revision that names the wrong head commit", async () => {
    await sql("UPDATE review_revisions SET head_commit_sha = $2 WHERE id = $1", [revisionId, unrelatedCommit]);
    try {
      const snapshots = await loadRunDesignBaseSnapshots(headRun, repositoryA, { DATABASE_URL: connectionString });
      expect(snapshots).toEqual([]);
    } finally {
      await sql("UPDATE review_revisions SET head_commit_sha = $2 WHERE id = $1", [revisionId, headCommit]);
    }
  });

  it("returns no comparison when a Review does not name an explicit base commit", async () => {
    await sql("UPDATE review_revisions SET base_commit_sha = NULL WHERE id = $1", [revisionId]);
    try {
      const snapshots = await loadRunDesignBaseSnapshots(headRun, repositoryA, { DATABASE_URL: connectionString });
      expect(snapshots).toEqual([]);
    } finally {
      await sql("UPDATE review_revisions SET base_commit_sha = $2 WHERE id = $1", [revisionId, baseCommit]);
    }
  });
});
