import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlArtifactDeletionStore } from "../../packages/db/src/artifact-deletion-store.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const pool = connectionString ? new pg.Pool({ connectionString, max: 3 }) : undefined;
const createdInstallations: string[] = [];
const createdExports: string[] = [];
const createdTokens: string[] = [];

function executor() {
  if (!db) throw new Error("Isolated PostgreSQL is required");
  return db;
}

async function fixture(owner: string, sharedPath = `shared/${randomUUID()}.bin`) {
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const runId = randomUUID();
  const artifactId = randomUUID();
  const tenant = `export-copy-${owner}-${randomUUID().slice(0, 8)}`;
  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
    [installationId, Math.floor(Math.random() * 10 ** 12), tenant],
  );
  createdInstallations.push(installationId);
  await executor().query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'board','main')",
    [repositoryId, installationId, Math.floor(Math.random() * 10 ** 12), tenant],
  );
  await executor().query(
    "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
    [runId, repositoryId, "a".repeat(40)],
  );
  await executor().query(
    `INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until)
     VALUES($1,$2,'manufacturing','synthetic.bin','package',$3,$4,17,'application/octet-stream',NOW()+INTERVAL '1 day')`,
    [artifactId, runId, sharedPath, "b".repeat(64)],
  );
  const store = new DataExportPreparationStore(executor());
  const exportId = await store.createBoundPendingExport({
    tenantId: tenant,
    installationId,
    requestedBy: "test-user",
    scope: "repository",
    scopeId: repositoryId,
  });
  if (!exportId) throw new Error("Claim fixture unavailable");
  createdExports.push(exportId);
  const claim = await store.claimNext({ installationId, workerId: "copy-test-worker" });
  if (!claim) throw new Error("Bound export claim unavailable");
  return { tenant, installationId, repositoryId, runId, artifactId, sharedPath, claim };
}

async function resultRows(sql: string, params: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> {
  const result = await executor().query(sql, params);
  return (result as { rows?: Record<string, unknown>[] }).rows ?? [];
}

async function begin(f: Awaited<ReturnType<typeof fixture>>, token: string, path = f.sharedPath) {
  return await resultRows("SELECT boardreadyops_begin_export_object_copy($1,$2,$3,$4,$5,$6,$7,$8::uuid) AS outcome", [
    f.claim.exportId,
    f.tenant,
    f.installationId,
    f.claim.workerId,
    f.claim.token,
    f.artifactId,
    path,
    token,
  ]);
}

async function finish(f: Awaited<ReturnType<typeof fixture>>, token: string) {
  return await resultRows("SELECT boardreadyops_finish_export_object_copy($1,$2,$3::uuid) AS outcome", [
    f.claim.exportId,
    f.claim.workerId,
    token,
  ]);
}

async function deletionJob(f: Awaited<ReturnType<typeof fixture>>, path = f.sharedPath) {
  const jobId = randomUUID();
  await executor().query(
    `INSERT INTO artifact_deletion_jobs (
      id,artifact_id,installation_id,repository_id,release_run_id,
      storage_driver,storage_path,deletion_reason,artifact_kind,artifact_role,
      artifact_sha256,artifact_bytes,available_at,created_at
    ) VALUES ($1,$2,$3,$4,$5,'local',$6,'result_replaced','manufacturing','package',$7,17,NOW(),NOW())`,
    [jobId, randomUUID(), f.installationId, f.repositoryId, f.runId, path, "b".repeat(64)],
  );
  return jobId;
}

afterAll(async () => {
  if (!db) return;
  try {
    await db.query("DELETE FROM artifact_export_copy_reservations WHERE token=ANY($1::uuid[])", [createdTokens]);
    await db.query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [createdExports]);
    await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [createdInstallations]);
  } finally {
    await Promise.all([db.close(), pool?.end()]);
  }
});

describeDatabase("durable export-copy and unlink admission", () => {
  it("copy-first defers native unlink without consuming retries; original token can release", async () => {
    const f = await fixture("copy-first");
    const token = randomUUID();
    createdTokens.push(token);
    expect((await begin(f, token))[0]?.outcome).toBe("reserved");
    const id = await deletionJob(f);
    const store = createSqlArtifactDeletionStore(executor());
    const claimed = await store.claimDeletions({ workerId: "deletion-worker" });
    expect(claimed.some((job) => job.deletionJobId === id)).toBe(true);
    const result = await store.beginPhysicalDeletion({
      deletionJobId: id,
      workerId: "deletion-worker",
      fenceToken: randomUUID(),
    });
    expect(result).toBe("held");
    const state = (
      await resultRows("SELECT status,attempt_count,last_error_class FROM artifact_deletion_jobs WHERE id=$1", [id])
    )[0];
    expect(state).toMatchObject({
      status: "available",
      attempt_count: 0,
      last_error_class: "export_copy_in_progress",
    });
    expect((await finish(f, randomUUID()))[0]?.outcome).toBe("stale");
    expect(
      (
        await resultRows(
          "SELECT count(*)::integer AS count FROM artifact_export_copy_reservations WHERE token=$1 AND released_at IS NULL",
          [token],
        )
      )[0]?.count,
    ).toBe(1);
    expect((await finish(f, token))[0]?.outcome).toBe("released");
    expect((await finish(f, token))[0]?.outcome).toBe("stale");
  });

  it("queued physical deletion denies new copy without inventing successful export", async () => {
    const f = await fixture("deletion-first");
    await deletionJob(f);
    const token = randomUUID();
    createdTokens.push(token);
    expect((await begin(f, token))[0]?.outcome).toBe("stale");
    expect(
      (
        await resultRows("SELECT count(*)::integer AS count FROM artifact_export_copy_reservations WHERE token=$1", [
          token,
        ])
      )[0]?.count,
    ).toBe(0);
  });
});

describeDatabase("shared-path locking and revocation across installations", () => {
  it("cross-tenant shared physical path remains fenced and revoked claims fail closed", async () => {
    const sharedPath = `shared/${randomUUID()}.bin`;
    const f = await fixture("copy-owner", sharedPath);
    const other = await fixture("delete-owner", sharedPath);
    const token = randomUUID();
    createdTokens.push(token);
    expect((await begin(f, token))[0]?.outcome).toBe("reserved");
    const id = await deletionJob(other);
    const store = createSqlArtifactDeletionStore(executor());
    expect(
      (await store.claimDeletions({ workerId: "foreign-worker", limit: 100 })).some((x) => x.deletionJobId === id),
    ).toBe(true);
    expect(
      await store.beginPhysicalDeletion({ deletionJobId: id, workerId: "foreign-worker", fenceToken: randomUUID() }),
    ).toBe("held");
    const wrongPath = randomUUID();
    expect((await begin(other, randomUUID(), wrongPath))[0]?.outcome).toBe("stale");
    await executor().query("UPDATE data_exports SET preparation_lease_until=NOW()-INTERVAL '1 second' WHERE id=$1", [
      f.claim.exportId,
    ]);
    expect((await begin(f, randomUUID()))[0]?.outcome).toBe("stale");
    expect((await finish(f, token))[0]?.outcome).toBe("released");
  });

  it("independent PG clients block on the durable shared-path admission lock", async () => {
    if (!pool) throw new Error("Missing isolated PostgreSQL pool");
    const f = await fixture("two-clients");
    const token = randomUUID();
    createdTokens.push(token);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(boardreadyops_artifact_path_lock_key($1))", [f.sharedPath]);
      const pending = begin(f, token);
      let waited = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await client.query(
          `SELECT count(*)::integer AS waiting FROM pg_stat_activity
           WHERE wait_event_type='Lock' AND wait_event='advisory' AND pid<>pg_backend_pid()`,
        );
        if (result.rows[0].waiting > 0) {
          waited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waited).toBe(true);
      await client.query("COMMIT");
      expect((await pending)[0]?.outcome).toBe("reserved");
      expect((await finish(f, token))[0]?.outcome).toBe("released");
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* already complete */
      }
      client.release();
    }
  });
});
