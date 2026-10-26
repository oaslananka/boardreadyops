import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleDraftProvenanceStatus } from "../../apps/web/lib/draft-provenance-routes.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const url = getPostgresTestConnectionString();
const describeDb = url ? describe : describe.skip;
const db = url ? createPgQueryExecutor({ connectionString: url, max: 2 }) : undefined;
const installationId = randomUUID();
const repositoryId = randomUUID();
const runId = randomUUID();
const attemptId = randomUUID();

beforeAll(async () => {
  if (!db) return;
  await db.query(
    "insert into installations (id, github_installation_id, account_login, account_type) values ($1,$2,$3,'Organization')",
    [installationId, randomInt(1_000_000_000, 2_000_000_000), "draft-auth-test"],
  );
  await db.query(
    "insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch) " +
      "values ($1,$2,$3,'draft-auth-test','draft-repo',false,'main')",
    [repositoryId, installationId, randomInt(1_000_000_000, 2_000_000_000)],
  );
  await db.query(
    "insert into release_runs " +
      "(id,repository_id,commit_sha,ref,trigger_kind,status,decision,started_at,completed_at) " +
      "values ($1,$2,$3,'refs/heads/main','push','completed','pass',now(),now())",
    [runId, repositoryId, "a".repeat(40)],
  );
});
afterAll(async () => {
  if (db) {
    try {
      await db.query("delete from installations where id=$1", [installationId]);
    } finally {
      await db.close();
    }
  }
});

describeDb("draft provenance access binds exact PostgreSQL run to session-authorized installation", () => {
  it("denies a foreign installation, even if that run exists", async () => {
    if (!url) throw new Error("PostgreSQL test database is required");
    const verify = vi.fn(async () => ({
      status: "verified-runner-claim" as const,
      archiveArtifactId: randomUUID(),
      receiptArtifactId: randomUUID(),
      archiveSha256: "a".repeat(64),
    }));
    const response = await handleDraftProvenanceStatus(runId, {
      authorize: async () => ({ session: {}, authorizeInstallation: async () => false }),
      openExecutor: () => createPgQueryExecutor({ connectionString: url, max: 1 }),
      verify,
      environment: { ARTIFACT_STORAGE_ROOT: "/unused" },
    });
    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(installationId);
  });

  it("reads current DB attempt but grants no manufacturing authorization", async () => {
    if (!url || !db) throw new Error("PostgreSQL test database is required");
    const verify = vi.fn(async () => ({
      status: "verified-runner-claim" as const,
      archiveArtifactId: randomUUID(),
      receiptArtifactId: randomUUID(),
      archiveSha256: "a".repeat(64),
    }));
    const authorizeInstallation = vi.fn(async (id: string) => id === installationId);
    const dependencies = {
      authorize: async () => ({ session: {}, authorizeInstallation }),
      openExecutor: () => createPgQueryExecutor({ connectionString: url, max: 1 }),
      verify,
      environment: { ARTIFACT_STORAGE_ROOT: "/unused", ARTIFACT_STORAGE_DRIVER: "local" },
    };
    const missingAttempt = await handleDraftProvenanceStatus(runId, dependencies);
    expect(await missingAttempt.json()).toEqual({ ok: true, status: "unverified", manufacturingApproved: false });
    expect(verify).not.toHaveBeenCalled();
    await db.query(
      "insert into release_run_attempts (id, run_id, attempt_number, status, started_at, completed_at) " +
        "values ($1,$2,1,'completed',now(),now())",
      [attemptId, runId],
    );
    await db.query("update release_runs set execution_attempt_id=$1, execution_attempt_started_at=now() where id=$2", [
      attemptId,
      runId,
    ]);
    const accepted = await handleDraftProvenanceStatus(runId, dependencies);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, status: "verified-runner-claim", manufacturingApproved: false });
    expect(authorizeInstallation).toHaveBeenCalledWith(installationId);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ runId, executionAttemptId: attemptId }));
  });
  it("fails closed when PostgreSQL suspends the installation after initial authorization", async () => {
    if (!url || !db) throw new Error("PostgreSQL test database is required");
    const authorizeInstallation = vi.fn(async (id: string) => {
      const result = (await db.query("select id from installations where id=$1 and suspended_at is null", [id])) as {
        rows: { id: string }[];
      };
      return result.rows.length === 1;
    });
    const verify = vi.fn(async () => {
      await db.query("update installations set suspended_at=now() where id=$1", [installationId]);
      return {
        status: "verified-runner-claim" as const,
        archiveArtifactId: randomUUID(),
        receiptArtifactId: randomUUID(),
        archiveSha256: "a".repeat(64),
      };
    });
    try {
      const result = await handleDraftProvenanceStatus(runId, {
        authorize: async () => ({ session: {}, authorizeInstallation }),
        openExecutor: () => createPgQueryExecutor({ connectionString: url, max: 1 }),
        verify,
        environment: { ARTIFACT_STORAGE_ROOT: "/unused-test-fixture" },
      });
      expect(result.status).toBe(404);
      expect(await result.json()).toEqual({ ok: false, error: "Run not found" });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(authorizeInstallation).toHaveBeenCalledTimes(2);
    } finally {
      await db.query("update installations set suspended_at=null where id=$1", [installationId]);
    }
  });
});
