import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadAuthorizedRemoteFindings } from "../../apps/web/lib/remote-mcp-findings.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describePg = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const installationId = randomUUID();
const repositoryId = randomUUID();
const runId = randomUUID();
const oldRunId = randomUUID();
const reviewId = randomUUID();
const revisionId = randomUUID();
const userId = 20261027;
const principal = { githubUserId: userId, grantId: "test-grant", scopes: ["review:read"] };
function executor() {
  if (!db) throw new Error("Disposable PostgreSQL is required for this test");
  return db;
}

describePg("live-authorized MCP finding pagination against PostgreSQL", () => {
  beforeAll(async () => {
    for (const file of [
      "0001_cloud_schema.sql",
      "0048_review_domain_spine.sql",
      "0056_marketplace_subscription_state.sql",
    ]) {
      const source = await readFile(new URL("../../packages/db/migrations/" + file, import.meta.url), "utf8");
      // This fixture needs the marketplace table but not its separate erasure lifecycle.
      // Run the exact production table/index definitions on this empty disposable DB.
      const sql =
        file === "0056_marketplace_subscription_state.sql"
          ? (source.split("ALTER TABLE erasure_requests")[0] ?? source)
          : source;
      await executor().query(sql);
    }
    await executor().query(
      "insert into installations (id, github_installation_id, account_login, account_type) values ($1, $2, $3, 'Organization')",
      [installationId, 20261027001, "authorized-fixture"],
    );
    await executor().query(
      "insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch) values ($1, $2, $3, $4, 'private-board', 'main')",
      [repositoryId, installationId, 20261027002, "authorized-fixture"],
    );
    for (const id of [runId, oldRunId]) {
      await executor().query(
        "insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind) values ($1, $2, $3, 'main', 'manual')",
        [id, repositoryId, "a".repeat(40)],
      );
    }
    await executor().query(
      "insert into reviews (id, repository_id, head_run_id, current_revision_id, title) values ($1, $2, $3, $4, 'Fixture Review')",
      [reviewId, repositoryId, runId, revisionId],
    );
    await executor().query(
      "insert into review_revisions (id, review_id, sequence, head_run_id, head_commit_sha, evidence_digest) values ($1, $2, 1, $3, $4, $5)",
      [revisionId, reviewId, runId, "a".repeat(40), "b".repeat(64)],
    );
    for (const index of Array.from({ length: 32 }, (_, i) => i + 1)) {
      await executor().query(
        "insert into findings (id, run_id, rule_id, severity, message, path, kind, fingerprint) values ($1, $2, $3, 'high', $4, $5, 'electrical', $6)",
        [
          String(index).padStart(6, "0"),
          runId,
          "drc.clearance",
          "PRIVATE DESIGN MESSAGE",
          "/secret/source/board.kicad_pcb",
          "fp_" + index,
        ],
      );
    }
    await executor().query(
      "insert into findings (id, run_id, rule_id, severity, message, path, fingerprint) values ($1, $2, 'private.legacy', 'error', 'OLD RUN', '/secret/old.kicad_pcb', 'fp_old')",
      [randomUUID(), oldRunId],
    );
  });
  afterAll(async () => {
    try {
      await executor().query("delete from installations where id = $1", [installationId]);
    } finally {
      await db?.close();
    }
  });

  it("pages exactly the current head run, never the older run or private messages/paths", async () => {
    const canRead = vi.fn().mockResolvedValue(true);
    const first = await loadAuthorizedRemoteFindings(executor(), principal, reviewId, undefined, canRead);
    expect(first?.findings).toHaveLength(30);
    expect(first?.nextCursor).toBe("000030");
    expect(canRead).toHaveBeenCalledWith({
      githubUserId: userId,
      githubRepositoryId: 20261027002,
      githubInstallationId: 20261027001,
      owner: "authorized-fixture",
      name: "private-board",
    });
    const last = await loadAuthorizedRemoteFindings(
      executor(),
      principal,
      reviewId,
      first?.nextCursor ?? undefined,
      canRead,
    );
    expect(last?.findings).toHaveLength(2);
    expect(last?.nextCursor).toBeNull();
    expect(canRead).toHaveBeenCalledTimes(2);
    const exported = JSON.stringify([first, last]);
    expect(exported).not.toContain("PRIVATE DESIGN");
    expect(exported).not.toContain("/secret/");
    expect(exported).not.toContain("fp_old");
    expect(exported).not.toContain("private.legacy");
  });

  it("denies a revoked user before querying the finding table", async () => {
    const denied = await loadAuthorizedRemoteFindings(
      executor(),
      principal,
      reviewId,
      undefined,
      vi.fn().mockResolvedValue(false),
    );
    expect(denied).toBeNull();
  });
});
