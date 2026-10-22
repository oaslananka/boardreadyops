import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { processArtifactDeletion } from "../../apps/web/lib/artifact-deletion-worker.js";
import { createSqlArtifactDeletionStore } from "../../packages/db/src/artifact-deletion-store.js";
import { DataLifecycleStore, LegalHoldAdmissionConflictError } from "../../packages/db/src/data-lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
let githubIdentifier = 995_000_000;
const createdInstallationIds: string[] = [];

function requireExecutor() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function fixture(label: string) {
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const runId = randomUUID();
  githubIdentifier += 1;
  await requireExecutor().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubIdentifier, `artifact-delete-${label}`],
  );
  createdInstallationIds.push(installationId);
  githubIdentifier += 1;
  await requireExecutor().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, $3, $4, $5, true, 'main')`,
    [repositoryId, installationId, githubIdentifier, `owner-${label}`, `repo-${label}`],
  );
  await requireExecutor().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at)
     values ($1, $2, $3, 'refs/heads/main', 'push', 'completed', now())`,
    [runId, repositoryId, createHash("sha256").update(runId).digest("hex").slice(0, 40)],
  );
  return { installationId, repositoryId, runId };
}

async function insertJob(input: Awaited<ReturnType<typeof fixture>>, artifactId: string): Promise<string> {
  const deletionJobId = randomUUID();
  await requireExecutor().query(
    `insert into artifact_deletion_jobs (
       id, artifact_id, installation_id, repository_id, release_run_id,
       storage_driver, storage_path, deletion_reason, artifact_kind,
       artifact_role, artifact_sha256, artifact_bytes, available_at, created_at
     ) values ($1, $2, $3, $4, $5, 'local', $6, 'result_replaced', 'report', 'primary', $7, 42, now(), now())`,
    [
      deletionJobId,
      artifactId,
      input.installationId,
      input.repositoryId,
      input.runId,
      `${input.runId}/${artifactId}.bin`,
      createHash("sha256").update(artifactId).digest("hex"),
    ],
  );
  return deletionJobId;
}

afterAll(async () => {
  if (executor && createdInstallationIds.length > 0) {
    // Cascades to repositories/release_runs/artifact_deletion_jobs. Without this the fixed-
    // start githubIdentifier counter collides with leftover rows on a re-run against a
    // persistent database (CI's ephemeral Postgres service never hits this).
    await executor.query("delete from installations where id = any($1::text[])", [createdInstallationIds]);
  }
  await executor?.close();
});

describeDatabase("artifact deletion PostgreSQL store", () => {
  it("checks the live lease and current tenant hold after claim, deferring without exhausting retries", async () => {
    const label = `recheck-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const lifecycle = new DataLifecycleStore(requireExecutor());
    const jobId = await insertJob(tenant, randomUUID());
    const now = new Date(Date.now() + 1_000);
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => now, leaseSeconds: 120 });

    const claimed = await store.claimDeletions({ workerId: "worker-hold-check", limit: 1 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.deletionJobId).toBe(jobId);

    // An unrelated tenant's hold must not defer this deletion.
    const otherTenant = `unrelated-hold-${randomUUID()}`;
    const unrelated = await lifecycle.createLegalHold({
      tenantId: otherTenant,
      createdBy: "authorized-operator",
      reason: "Unrelated tenant data must remain isolated.",
      scope: "organization",
    });
    try {
      await expect(lifecycle.hasActiveHold(otherTenant, "organization")).resolves.toBe(true);
      await expect(lifecycle.hasActiveHold(`artifact-delete-${label}`, "organization")).resolves.toBe(false);

      // A matching repository hold arriving after the claim must suspend
      // the job without unlinking or burning its bounded retry budget.
      const held = await lifecycle.createLegalHold({
        tenantId: `artifact-delete-${label}`,
        createdBy: "authorized-operator",
        reason: "Hold during review before artifact deletion.",
        scope: "repository",
        scopeId: tenant.repositoryId,
      });
      try {
        expect(
          await store.beginPhysicalDeletion({
            deletionJobId: jobId,
            workerId: "wrong-worker",
            fenceToken: randomUUID(),
          }),
        ).toBe("stale");
        expect(
          await store.beginPhysicalDeletion({
            deletionJobId: jobId,
            workerId: "worker-hold-check",
            fenceToken: randomUUID(),
          }),
        ).toBe("held");

        const result = await requireExecutor().query(
          `select status, attempt_count, lease_owner, last_error_class
             from artifact_deletion_jobs where id = $1`,
          [jobId],
        );
        expect(rows(result)).toEqual([
          {
            status: "available",
            attempt_count: 0,
            lease_owner: null,
            last_error_class: "legal_hold",
          },
        ]);
        expect(
          rows(
            await requireExecutor().query(
              "select token from artifact_unlink_fences where deletion_job_id=$1 and settled_at is null",
              [jobId],
            ),
          ),
        ).toHaveLength(0);
        expect(await store.claimDeletions({ workerId: "worker-hold-check", limit: 1 })).toEqual([]);
      } finally {
        await lifecycle.releaseLegalHold(`artifact-delete-${label}`, held.id, "authorized-operator");
      }
      const afterBackoff = createSqlArtifactDeletionStore(requireExecutor(), {
        now: () => new Date(now.valueOf() + 31 * 60_000),
        leaseSeconds: 120,
      });
      const resumed = await afterBackoff.claimDeletions({ workerId: "worker-hold-check", limit: 1 });
      expect(resumed[0]?.deletionJobId).toBe(jobId);
      const fenceToken = randomUUID();
      expect(
        await afterBackoff.beginPhysicalDeletion({
          deletionJobId: jobId,
          workerId: "worker-hold-check",
          fenceToken,
        }),
      ).toBe("authorized");
      expect(
        await afterBackoff.completeDeletion({
          deletionJobId: jobId,
          workerId: "worker-hold-check",
          outcome: "missing",
        }),
      ).toBe("completed");
      await expect(
        afterBackoff.settlePhysicalDeletion({
          deletionJobId: jobId,
          workerId: "worker-hold-check",
          fenceToken,
          outcome: "missing",
        }),
      ).resolves.toBe("settled");
    } finally {
      await lifecycle.releaseLegalHold(otherTenant, unrelated.id, "authorized-operator");
      await requireExecutor().query("delete from legal_holds where tenant_id = $1", [otherTenant]);
      await requireExecutor().query("delete from legal_holds where tenant_id = $1", [`artifact-delete-${label}`]);
    }
  });

  it("refuses an expired lease even if the deletion worker clock is a year behind PostgreSQL", async () => {
    const label = `expired-clock-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const jobId = await insertJob(tenant, randomUUID());
    // An expired leased fixture is intentionally retriable by another worker.
    // Remove it before later tests can claim this job from the shared CI database.
    try {
      const normalStore = createSqlArtifactDeletionStore(requireExecutor(), {
        now: () => new Date(Date.now() + 1_000),
        leaseSeconds: 120,
      });
      const claimed = await normalStore.claimDeletions({ workerId: "clock-skew-worker", limit: 1 });
      expect(claimed[0]?.deletionJobId).toBe(jobId);

      // The PostgreSQL lease is really expired; do not trust the caller's clock
      // to decide that destructive filesystem work can begin.
      await requireExecutor().query(
        "update artifact_deletion_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where id=$1",
        [jobId],
      );
      const oneYearBehind = new Date(Date.now() - 365 * 24 * 60 * 60 * 1_000);
      const skewedStore = createSqlArtifactDeletionStore(requireExecutor(), {
        now: () => oneYearBehind,
      });
      await expect(
        skewedStore.beginPhysicalDeletion({
          deletionJobId: jobId,
          workerId: "clock-skew-worker",
          fenceToken: randomUUID(),
        }),
      ).resolves.toBe("stale");
      expect(
        rows(
          await requireExecutor().query("select status, lease_owner from artifact_deletion_jobs where id=$1", [jobId]),
        ),
      ).toEqual([{ status: "leased", lease_owner: "clock-skew-worker" }]);
    } finally {
      await requireExecutor().query("delete from artifact_deletion_jobs where id=$1", [jobId]);
    }
  });

  it("blocks deletion across mixed-case GitHub tenant logins without leaking an unrelated tenant", async () => {
    const label = `case-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const canonicalTenantId = `artifact-delete-${label}`;
    const differentCase = canonicalTenantId.toUpperCase();
    const otherTenant = `unrelated-${randomUUID()}`;
    const jobId = await insertJob(tenant, randomUUID());
    const lifecycle = new DataLifecycleStore(requireExecutor());
    const store = createSqlArtifactDeletionStore(requireExecutor(), {
      now: () => new Date(Date.now() + 1_000),
      leaseSeconds: 120,
    });

    const unrelatedHold = await lifecycle.createLegalHold({
      tenantId: otherTenant,
      createdBy: "operator-case",
      reason: "Do not affect a different GitHub tenant.",
      scope: "organization",
    });
    let protectedHoldId: string | undefined;
    let erasureId: string | undefined;
    try {
      // Unrelated holds still cannot suppress the correct tenant's lease.
      const claimed = await store.claimDeletions({ workerId: "case-worker", limit: 1 });
      expect(claimed[0]?.deletionJobId).toBe(jobId);
      const protectedHold = await lifecycle.createLegalHold({
        tenantId: differentCase,
        createdBy: "operator-case",
        reason: "Protect data for the case-insensitive GitHub organization.",
        scope: "organization",
      });
      protectedHoldId = protectedHold.id;
      expect(await lifecycle.hasActiveHold(canonicalTenantId, "repository", tenant.repositoryId)).toBe(true);
      expect((await lifecycle.listLegalHolds(canonicalTenantId)).map((h) => h.id)).toContain(protectedHold.id);

      const erasure = await lifecycle.createErasure({
        tenantId: canonicalTenantId,
        requestedBy: "operator-case",
        scope: "repository",
        scopeId: tenant.repositoryId,
      });
      erasureId = erasure.id;
      expect(erasure.status).toBe("blocked_by_hold");
      await expect(
        store.beginPhysicalDeletion({
          deletionJobId: jobId,
          workerId: "case-worker",
          fenceToken: randomUUID(),
        }),
      ).resolves.toBe("held");

      expect(
        rows(
          await requireExecutor().query(
            "select status, attempt_count, last_error_class from artifact_deletion_jobs where id=$1",
            [jobId],
          ),
        ),
      ).toEqual([{ status: "available", attempt_count: 0, last_error_class: "legal_hold" }]);

      await expect(lifecycle.releaseLegalHold(canonicalTenantId, protectedHold.id, "operator-case")).resolves.toBe(
        true,
      );
      expect((await lifecycle.listLegalHolds(differentCase)).find((h) => h.id === protectedHold.id)?.active).toBe(
        false,
      );
      expect(
        rows(await requireExecutor().query("select status from erasure_requests where id=$1", [erasure.id])),
      ).toEqual([{ status: "blocked_by_hold" }]);
    } finally {
      if (erasureId) {
        await requireExecutor().query("delete from erasure_requests where id=$1", [erasureId]);
      }
      if (protectedHoldId) {
        await requireExecutor().query("delete from legal_holds where id=$1", [protectedHoldId]);
      }
      await lifecycle.releaseLegalHold(otherTenant, unrelatedHold.id, "operator-case");
      await requireExecutor().query("delete from legal_holds where id=$1", [unrelatedHold.id]);
    }
  });

  it("linearizes a concurrent hold INSERT behind an uncommitted unlink admission", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL required");
    const label = `gate-order-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const tenantId = `artifact-delete-${label}`;
    const jobId = await insertJob(tenant, randomUUID());
    const workerId = "fenced-deletion-session";
    const token = randomUUID();
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => new Date(Date.now() + 1_000) });
    expect((await store.claimDeletions({ workerId, limit: 1 }))[0]?.deletionJobId).toBe(jobId);
    const writer = new pg.Client({ connectionString });
    const waiterName = `hold-wait-${randomUUID().slice(0, 8)}`;
    const hold = new pg.Client({ connectionString, application_name: waiterName });
    await writer.connect();
    await hold.connect();
    let writeResult: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    let committed = false;
    try {
      await writer.query("begin");
      expect(
        (
          await writer.query("select boardreadyops_begin_artifact_unlink($1,$2,$3::uuid) as outcome", [
            jobId,
            workerId,
            token,
          ])
        ).rows[0]?.outcome,
      ).toBe("authorized");
      // Start a true second backend's INSERT before the writer commits.
      // Observe a possible rejection immediately: PostgreSQL can reject the
      // blocked INSERT before the polling loop reaches its later assertion.
      writeResult = hold
        .query(
          "insert into legal_holds (id,tenant_id,created_by,reason,scope) values ($1,$2,'operator','Hold must not acknowledge during unlink','organization')",
          [randomUUID(), tenantId],
        )
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      let waiting = false;
      for (let attempt = 0; attempt < 35; attempt++) {
        const observed = rows(
          await requireExecutor().query(
            "select wait_event from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",
            [waiterName],
          ),
        );
        if (observed.some((row) => row.wait_event === "advisory")) {
          waiting = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await writer.query("commit");
      committed = true;
      await expect(writeResult).resolves.toMatchObject({ ok: false, error: { code: "B4401" } });
      await expect(
        store.completeDeletion({
          deletionJobId: jobId,
          workerId,
          outcome: "missing",
        }),
      ).resolves.toBe("completed");
      await expect(
        store.settlePhysicalDeletion({
          deletionJobId: jobId,
          workerId,
          fenceToken: token,
          outcome: "missing",
        }),
      ).resolves.toBe("settled");
    } finally {
      if (!committed) await writer.query("rollback").catch(() => {});
      await writeResult;
      await writer.end();
      await hold.end();
      await requireExecutor().query("delete from legal_holds where tenant_id=$1", [tenantId]);
    }
  });

  it("linearizes a concurrent deletion behind a committed hold in the opposite order", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL required");
    const label = `gate-reverse-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const tenantId = `artifact-delete-${label}`;
    const jobId = await insertJob(tenant, randomUUID());
    const workerId = "fenced-hold-first-worker";
    const token = randomUUID();
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => new Date(Date.now() + 1_000) });
    expect((await store.claimDeletions({ workerId, limit: 1 }))[0]?.deletionJobId).toBe(jobId);
    const writer = new pg.Client({ connectionString });
    const waiterName = `delete-wait-${randomUUID().slice(0, 8)}`;
    const waiter = new pg.Client({ connectionString, application_name: waiterName });
    await writer.connect();
    await waiter.connect();
    let blockedQuery: Promise<pg.QueryResult> | undefined;
    let committed = false;
    try {
      await writer.query("begin");
      const holdId = randomUUID();
      await writer.query(
        "insert into legal_holds (id,tenant_id,created_by,reason,scope) values ($1,$2,'operator','Retain while concurrent deletion starts','organization')",
        [holdId, tenantId],
      );
      blockedQuery = waiter.query("select boardreadyops_begin_artifact_unlink($1,$2,$3::uuid) as outcome", [
        jobId,
        workerId,
        token,
      ]);
      let waiting = false;
      for (let attempt = 0; attempt < 35; attempt++) {
        const observed = rows(
          await requireExecutor().query(
            "select wait_event from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",
            [waiterName],
          ),
        );
        if (observed.some((row) => row.wait_event === "advisory")) {
          waiting = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await writer.query("commit");
      committed = true;
      expect((await blockedQuery).rows[0]?.outcome).toBe("held");
      expect(
        rows(
          await requireExecutor().query(
            "select token from artifact_unlink_fences where deletion_job_id=$1 and settled_at is null",
            [jobId],
          ),
        ),
      ).toHaveLength(0);
    } finally {
      if (!committed) await writer.query("rollback").catch(() => {});
      await blockedQuery?.catch(() => {});
      await writer.end();
      await waiter.end();
      await requireExecutor().query("delete from legal_holds where tenant_id=$1", [tenantId]);
    }
  });

  it("rejects inactive-hold reactivation and installation deletion while a tenant unlink fence is unresolved", async () => {
    const label = `hold-reactivate-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const tenantId = `artifact-delete-${label}`;
    const workerId = "hold-reactivate-worker";
    const jobId = await insertJob(tenant, randomUUID());
    const token = randomUUID();
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => new Date(Date.now() + 1_000) });
    const lifecycle = new DataLifecycleStore(requireExecutor());
    const hold = await lifecycle.createLegalHold({
      tenantId,
      createdBy: "operator",
      reason: "Initial hold, later reactivated",
      scope: "organization",
    });

    try {
      await expect(lifecycle.releaseLegalHold(tenantId, hold.id, "operator")).resolves.toBe(true);
      expect((await store.claimDeletions({ workerId, limit: 1 }))[0]?.deletionJobId).toBe(jobId);
      await expect(store.beginPhysicalDeletion({ deletionJobId: jobId, workerId, fenceToken: token })).resolves.toBe(
        "authorized",
      );

      // Reactivating an existing hold is another hold admission, not a bypass
      // just because the hold record was already in the table.
      await expect(
        requireExecutor().query("update legal_holds set active=true where id=$1", [hold.id]),
      ).rejects.toMatchObject({ code: "B4401" });
      expect(rows(await requireExecutor().query("select active from legal_holds where id=$1", [hold.id]))).toEqual([
        { active: false },
      ]);

      // Installation removal cannot invalidate the canonical tenant key
      // while this external I/O outcome is still uncertain.
      await expect(
        requireExecutor().query("delete from installations where id=$1", [tenant.installationId]),
      ).rejects.toMatchObject({ code: "B4401" });
      expect(
        rows(await requireExecutor().query("select id from installations where id=$1", [tenant.installationId])),
      ).toHaveLength(1);

      await expect(
        store.completeDeletion({
          deletionJobId: jobId,
          workerId,
          outcome: "missing",
        }),
      ).resolves.toBe("completed");
      await expect(
        store.settlePhysicalDeletion({
          deletionJobId: jobId,
          workerId,
          fenceToken: token,
          outcome: "missing",
        }),
      ).resolves.toBe("settled");
      await expect(
        requireExecutor().query("update legal_holds set active=true where id=$1 returning active", [hold.id]),
      ).resolves.toMatchObject({ rows: [{ active: true }] });
    } finally {
      // Disposable-only test fixture; the local PG installation is never production.
      await requireExecutor().query("delete from legal_holds where id=$1", [hold.id]);
    }
  });

  it("preserves unresolved fences across repository/run cascades and direct job mutations", async () => {
    const tenant = await fixture(`fence-ownership-${randomUUID().slice(0, 8)}`);
    const jobId = await insertJob(tenant, randomUUID());
    const token = randomUUID();
    const workerId = "fence-ownership-worker";
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => new Date(Date.now() + 1_000) });
    expect((await store.claimDeletions({ workerId, limit: 1 }))[0]?.deletionJobId).toBe(jobId);
    await expect(store.beginPhysicalDeletion({ deletionJobId: jobId, workerId, fenceToken: token })).resolves.toBe(
      "authorized",
    );
    for (const [sql, params] of [
      ["delete from artifact_deletion_jobs where id = $1", [jobId]],
      ["delete from release_runs where id = $1", [tenant.runId]],
      ["delete from repositories where id = $1", [tenant.repositoryId]],
      ["update artifact_deletion_jobs set storage_path = $2 where id = $1", [jobId, "changed.bin"]],
    ] as const) {
      await expect(requireExecutor().query(sql, [...params])).rejects.toMatchObject({ code: "B4401" });
    }
    await expect(requireExecutor().query("truncate artifact_deletion_jobs cascade")).rejects.toMatchObject({
      code: "B4401",
    });
    expect(rows(await requireExecutor().query("select id from artifact_deletion_jobs where id=$1", [jobId]))).toEqual([
      { id: jobId },
    ]);
    expect(
      rows(
        await requireExecutor().query("select settled_at from artifact_unlink_fences where deletion_job_id=$1", [
          jobId,
        ]),
      ),
    ).toEqual([{ settled_at: null }]);
    await expect(store.completeDeletion({ deletionJobId: jobId, workerId, outcome: "missing" })).resolves.toBe(
      "completed",
    );
    await expect(
      store.settlePhysicalDeletion({ deletionJobId: jobId, workerId, fenceToken: token, outcome: "missing" }),
    ).resolves.toBe("settled");
    await expect(
      requireExecutor().query("delete from artifact_deletion_jobs where id=$1", [jobId]),
    ).resolves.toMatchObject({
      rowCount: 1,
    });
  });

  it("keeps the durable fence after a client disconnect and simulated crash before audit completion", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL required");
    const label = `crash-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const artifactId = randomUUID();
    const jobId = await insertJob(tenant, artifactId);
    const tenantId = `artifact-delete-${label}`;
    const workerId = "crash-before-audit-worker";
    const token = randomUUID();
    const originalConnection = createPgQueryExecutor({ connectionString, max: 1 });
    const beforeDisconnect = createSqlArtifactDeletionStore(originalConnection, {
      now: () => new Date(Date.now() + 1_000),
    });
    const lifecycle = new DataLifecycleStore(requireExecutor());
    const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-fence-crash-"));
    const objectPath = path.join(root, tenant.runId, `${artifactId}.bin`);
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, "DISPOSABLE SYNTHETIC OBJECT");
    try {
      expect((await beforeDisconnect.claimDeletions({ workerId, limit: 1 }))[0]?.deletionJobId).toBe(jobId);
      await expect(
        beforeDisconnect.beginPhysicalDeletion({
          deletionJobId: jobId,
          workerId,
          fenceToken: token,
        }),
      ).resolves.toBe("authorized");
      // A fully committed DB fence is independent of the original PG pool.
      await originalConnection.close();
      await unlink(objectPath); // Simulated crash after unlink, before audit/settlement.

      await expect(
        lifecycle.createLegalHold({
          tenantId,
          createdBy: "legal-operator",
          reason: "Hold should fail closed after crash",
          scope: "organization",
        }),
      ).rejects.toBeInstanceOf(LegalHoldAdmissionConflictError);
      await expect(
        requireExecutor().query(
          "insert into legal_holds (id, tenant_id, created_by, reason, scope) values ($1,$2,'raw-writer','Raw direct hold must be fenced','organization')",
          [randomUUID(), tenantId.toUpperCase()],
        ),
      ).rejects.toMatchObject({ code: "B4401" });
      const recovered = createSqlArtifactDeletionStore(requireExecutor(), {
        now: () => new Date(Date.now() + 60_000),
      });
      await requireExecutor().query(
        "update artifact_deletion_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [jobId],
      );
      await expect(recovered.claimDeletions({ workerId: "new-worker", limit: 1 })).resolves.toEqual([]);
      await expect(
        recovered.settlePhysicalDeletion({
          deletionJobId: jobId,
          workerId,
          fenceToken: token,
          outcome: "deleted",
        }),
      ).resolves.toBe("stale");

      // Synthetic operator proof establishes the missing object; the original
      // lease owner can then persist audit and settle the fence intentionally.
      await expect(readFile(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        recovered.completeDeletion({
          deletionJobId: jobId,
          workerId,
          outcome: "deleted",
        }),
      ).resolves.toBe("completed");
      await expect(
        recovered.settlePhysicalDeletion({
          deletionJobId: jobId,
          workerId,
          fenceToken: token,
          outcome: "deleted",
        }),
      ).resolves.toBe("settled");
      const hold = await lifecycle.createLegalHold({
        tenantId,
        createdBy: "legal-operator",
        reason: "Only after the resolved deletion is terminal",
        scope: "organization",
      });
      expect(hold.active).toBe(true);
      await lifecycle.releaseLegalHold(tenantId, hold.id, "legal-operator");
    } finally {
      await originalConnection.close().catch(() => {});
      await requireExecutor().query("delete from legal_holds where lower(tenant_id)=lower($1)", [tenantId]);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves a committed fence after a real child process is SIGKILLed before audit", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL required");
    const label = `sigkill-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const artifactId = randomUUID();
    const jobId = await insertJob(tenant, artifactId);
    const tenantId = `artifact-delete-${label}`;
    const workerId = `sigkill-worker-${randomUUID().slice(0, 8)}`;
    const token = randomUUID();
    const store = createSqlArtifactDeletionStore(requireExecutor(), {
      now: () => new Date(Date.now() + 1_000),
      leaseSeconds: 120,
    });
    expect((await store.claimDeletions({ workerId, limit: 1 }))[0]?.deletionJobId).toBe(jobId);
    const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-real-kill-"));
    const objectPath = path.join(root, tenant.runId, `${artifactId}.bin`);
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, "DISPOSABLE PROCESS-CRASH ACCEPTANCE ONLY");

    // The test child is an independent Node process and PostgreSQL session,
    // exercising the exact admission SQL invoked by the production store.
    // This is not a boot of the complete production worker. SIGKILL occurs
    // AFTER unlink and BEFORE audit/settlement.
    const childScript = `
      const { Client } = require('pg');
      const { unlink } = require('node:fs/promises');
      (async () => {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        const result = await client.query(
          'select boardreadyops_begin_artifact_unlink($1, $2, $3::uuid) as outcome',
          [process.argv[1], process.argv[2], process.argv[3]],
        );
        if (result.rows[0]?.outcome !== 'authorized') throw new Error('fence not authorized');
        await unlink(process.argv[4]);
        if (process.send) process.send({ phase: 'unlinked' });
        setInterval(() => {}, 1000);
      })().catch(() => { if (process.send) process.send({ phase: 'error' }); process.exit(1); });
    `;
    const child = spawn(process.execPath, ["-e", childScript, jobId, workerId, token, objectPath], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const lifecycle = new DataLifecycleStore(requireExecutor());
    try {
      const phase = await new Promise<string>((resolve, reject) => {
        child.once("message", (message: unknown) => {
          const value = message && typeof message === "object" && "phase" in message ? message.phase : undefined;
          resolve(typeof value === "string" ? value : "invalid-message");
        });
        child.once("error", reject);
        child.once("exit", () => reject(new Error("unlink child exited before acknowledging filesystem state")));
      });
      expect(phase).toBe("unlinked");
      child.kill("SIGKILL");
      const exitSignal = await new Promise<NodeJS.Signals | null>((resolve) => {
        child.once("exit", (_code, signal) => resolve(signal));
      });
      expect(exitSignal).toBe("SIGKILL");
      await expect(readFile(objectPath)).rejects.toMatchObject({ code: "ENOENT" });

      const fence = rows(
        await requireExecutor().query("select token, settled_at from artifact_unlink_fences where deletion_job_id=$1", [
          jobId,
        ]),
      );
      expect(fence).toEqual([{ token, settled_at: null }]);
      await expect(
        lifecycle.createLegalHold({
          tenantId,
          createdBy: "authorized-operator",
          reason: "Hold must not acknowledge after a real SIGKILL",
          scope: "organization",
        }),
      ).rejects.toBeInstanceOf(LegalHoldAdmissionConflictError);

      await requireExecutor().query(
        "update artifact_deletion_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [jobId],
      );
      const recovering = createSqlArtifactDeletionStore(requireExecutor(), {
        now: () => new Date(Date.now() + 60_000),
      });
      await expect(recovering.claimDeletions({ workerId: "sigkill-recovery", limit: 1 })).resolves.toEqual([]);
      await expect(
        recovering.settlePhysicalDeletion({
          deletionJobId: jobId,
          workerId,
          fenceToken: token,
          outcome: "deleted",
        }),
      ).resolves.toBe("stale");

      // Deliberately do NOT settle an ambiguous crash as part of automated
      // recovery. An authenticated operator needs separate evidence and audit.
      expect(
        rows(
          await requireExecutor().query("select settled_at from artifact_unlink_fences where deletion_job_id=$1", [
            jobId,
          ]),
        ),
      ).toEqual([{ settled_at: null }]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      // Test-only cleanup settles the known, disposable fixture before the
      // afterAll installation cascade; not a model for production recovery.
      await store.completeDeletion({ deletionJobId: jobId, workerId, outcome: "deleted" });
      await store.settlePhysicalDeletion({ deletionJobId: jobId, workerId, fenceToken: token, outcome: "deleted" });
      await requireExecutor().query("delete from legal_holds where tenant_id=$1", [tenantId]);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prevents hold acknowledgement during irreversible unlink, then admits after settlement", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL required");
    const label = `race-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const artifactId = randomUUID();
    const jobId = await insertJob(tenant, artifactId);
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => new Date(Date.now() + 1_000) });
    const claimed = await store.claimDeletions({ workerId: "hold-race-worker", limit: 1 });
    expect(claimed).toHaveLength(1);
    const claimedJob = claimed[0];
    if (!claimedJob) throw new Error("Expected a claimed job.");

    const otherSession = createPgQueryExecutor({ connectionString, max: 1 });
    const lifecycle = new DataLifecycleStore(otherSession);
    const tenantId = `artifact-delete-${label}`;
    const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-hold-race-"));
    const objectPath = path.join(root, tenant.runId, `${artifactId}.bin`);
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, "SYNTHETIC DATA ONLY");
    let reached!: () => void;
    let resume!: () => void;
    const atUnlink = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const canUnlink = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const deletion = processArtifactDeletion(claimedJob, {
      workerId: "hold-race-worker",
      store,
      storageRoot: root,
      deleteLocalObject: async () => {
        reached();
        await canUnlink;
        await unlink(objectPath);
        return "deleted";
      },
    });
    try {
      await atUnlink;
      const barriers = rows(
        await otherSession.query("select token, settled_at from artifact_unlink_fences where deletion_job_id=$1", [
          jobId,
        ]),
      );
      expect(barriers).toHaveLength(1);
      expect(barriers[0]?.settled_at).toBeNull();

      // This formerly passed and allowed deleting under an acknowledged hold.
      // A durable active fence now rejects success from a second PG pool.
      await expect(
        lifecycle.createLegalHold({
          tenantId,
          createdBy: "synthetic-operator",
          reason: "Retain synthetic artifact during unlink",
          scope: "organization",
        }),
      ).rejects.toBeInstanceOf(LegalHoldAdmissionConflictError);
      expect(
        rows(await otherSession.query("select id from legal_holds where tenant_id=$1 and active=true", [tenantId])),
      ).toHaveLength(0);
      await expect(readFile(objectPath)).resolves.toBeInstanceOf(Buffer);

      await requireExecutor().query(
        "update artifact_deletion_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [jobId],
      );
      const recovering = createSqlArtifactDeletionStore(otherSession, { now: () => new Date(Date.now() + 60_000) });
      await expect(recovering.claimDeletions({ workerId: "reclaim-worker", limit: 1 })).resolves.toEqual([]);
      await expect(
        otherSession.query("update installations set account_login=$2 where id=$1", [
          tenant.installationId,
          `renamed-${randomUUID()}`,
        ]),
      ).rejects.toMatchObject({ code: "B4401" });

      resume();
      expect(await deletion).toMatchObject({ status: "completed", outcome: "deleted" });
      await expect(readFile(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        rows(
          await otherSession.query(
            "select settled_at is not null as settled from artifact_unlink_fences where deletion_job_id=$1",
            [jobId],
          ),
        ),
      ).toEqual([{ settled: true }]);
      const accepted = await lifecycle.createLegalHold({
        tenantId,
        createdBy: "synthetic-operator",
        reason: "Hold acknowledged after previous unlink completed",
        scope: "organization",
      });
      expect(accepted.active).toBe(true);
      await lifecycle.releaseLegalHold(tenantId, accepted.id, "synthetic-operator");
    } finally {
      resume();
      await deletion.catch(() => {});
      await otherSession.query("delete from legal_holds where tenant_id=$1", [tenantId]);
      await otherSession.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("claims and completes an idempotent missing-object deletion with audit proof", async () => {
    const tenant = await fixture(`complete-${randomUUID().slice(0, 8)}`);
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    const at = new Date(Date.now() + 1_000);
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => at, leaseSeconds: 60 });

    const claimed = await store.claimDeletions({ workerId: "artifact-worker-1", limit: 1 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ deletionJobId, artifactId, storageDriver: "local", attemptCount: 1 });
    await expect(
      store.completeDeletion({ deletionJobId, workerId: "artifact-worker-1", outcome: "missing" }),
    ).resolves.toBe("completed");

    expect(
      rows(
        await requireExecutor().query("select status, deletion_outcome from artifact_deletion_jobs where id = $1", [
          deletionJobId,
        ]),
      ),
    ).toEqual([{ status: "completed", deletion_outcome: "missing" }]);
    expect(
      rows(
        await requireExecutor().query(
          `select event_type, subject_id, repository_id, release_run_id, metadata
           from audit_events where event_type = 'artifact.object.deleted' and subject_id = $1`,
          [artifactId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        event_type: "artifact.object.deleted",
        subject_id: artifactId,
        repository_id: tenant.repositoryId,
        release_run_id: tenant.runId,
        metadata: expect.objectContaining({ outcome: "missing", reason: "result_replaced", storageDriver: "local" }),
      }),
    ]);
  });

  it("dead-letters an exhausted expired lease with audit proof before claiming new work", async () => {
    const tenant = await fixture(`expired-${randomUUID().slice(0, 8)}`);
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    const firstAt = new Date(Date.now() + 1_000);
    const firstStore = createSqlArtifactDeletionStore(requireExecutor(), { now: () => firstAt, leaseSeconds: 1 });

    await firstStore.claimDeletions({ workerId: "artifact-worker-expired", limit: 1 });
    await requireExecutor().query("update artifact_deletion_jobs set max_attempts = 1 where id = $1", [deletionJobId]);

    const recoveredAt = new Date(firstAt.valueOf() + 2_000);
    const recoveringStore = createSqlArtifactDeletionStore(requireExecutor(), { now: () => recoveredAt });
    await expect(recoveringStore.claimDeletions({ workerId: "artifact-worker-recovery", limit: 1 })).resolves.toEqual(
      [],
    );

    expect(
      rows(
        await requireExecutor().query(
          "select status, last_error_class, completed_at is not null as completed from artifact_deletion_jobs where id = $1",
          [deletionJobId],
        ),
      ),
    ).toEqual([{ status: "dead_letter", last_error_class: "lease_expired", completed: true }]);
    expect(
      rows(
        await requireExecutor().query(
          `select event_type, subject_id, metadata
           from audit_events where event_type = 'artifact.object.deletion_failed' and subject_id = $1`,
          [artifactId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        event_type: "artifact.object.deletion_failed",
        subject_id: artifactId,
        metadata: expect.objectContaining({ errorClass: "lease_expired", attemptCount: 1 }),
      }),
    ]);
  });

  it("quarantines an ambiguous unlink after synthetic removal and blocks subsequent holds and reclaim", async () => {
    const label = `unlink-ambiguous-${randomUUID().slice(0, 8)}`;
    const tenant = await fixture(label);
    const tenantId = `artifact-delete-${label}`;
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    let at = new Date(Date.now() + 1_000);
    const deletionStore = createSqlArtifactDeletionStore(requireExecutor(), {
      now: () => at,
      retryBaseSeconds: 1,
    });
    const [job] = await deletionStore.claimDeletions({ workerId: "uncertain-unlink-worker", limit: 1 });
    expect(job?.deletionJobId).toBe(deletionJobId);
    if (!job) throw new Error("Expected claimed test deletion.");

    const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-uncertain-unlink-"));
    const objectPath = path.join(root, job.storagePath);
    const lifecycle = new DataLifecycleStore(requireExecutor());
    try {
      await mkdir(path.dirname(objectPath), { recursive: true });
      await writeFile(objectPath, "SYNTHETIC DATA ONLY");
      const result = await processArtifactDeletion(job, {
        workerId: "uncertain-unlink-worker",
        storageRoot: root,
        store: deletionStore,
        deleteLocalObject: async () => {
          // The physical effect occurred but the caller observed a rejection.
          await unlink(objectPath);
          throw new Error("ambiguous error after irreversible unlink");
        },
      });
      expect(result.status).toBe("retry");
      await expect(readFile(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        rows(
          await requireExecutor().query("select settled_at from artifact_unlink_fences where deletion_job_id = $1", [
            deletionJobId,
          ]),
        ),
      ).toEqual([{ settled_at: null }]);
      await expect(
        lifecycle.createLegalHold({
          tenantId,
          createdBy: "operator",
          reason: "Reject a false hold admission after ambiguous unlink",
          scope: "organization",
        }),
      ).rejects.toBeInstanceOf(LegalHoldAdmissionConflictError);
      at = new Date(at.valueOf() + 5_000);
      await expect(deletionStore.claimDeletions({ workerId: "other-worker", limit: 1 })).resolves.toEqual([]);
    } finally {
      // All objects and rows are disposable test fixtures; no production data.
      await requireExecutor().query("delete from artifact_unlink_fences where deletion_job_id = $1", [deletionJobId]);
      await requireExecutor().query("delete from artifact_deletion_jobs where id = $1", [deletionJobId]);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries transient failures and dead-letters permanent failures with audit proof", async () => {
    const tenant = await fixture(`failure-${randomUUID().slice(0, 8)}`);
    const artifactId = randomUUID();
    const deletionJobId = await insertJob(tenant, artifactId);
    let at = new Date(Date.now() + 1_000);
    const store = createSqlArtifactDeletionStore(requireExecutor(), { now: () => at, retryBaseSeconds: 1 });

    await store.claimDeletions({ workerId: "artifact-worker-2", limit: 1 });
    await expect(
      store.failDeletion({
        deletionJobId,
        workerId: "artifact-worker-2",
        attemptCount: 1,
        retryable: true,
        errorClass: "EIO",
        errorMessage: "temporary filesystem failure",
      }),
    ).resolves.toBe("retry");

    at = new Date(at.valueOf() + 2_000);
    const retried = await store.claimDeletions({ workerId: "artifact-worker-2", limit: 1 });
    expect(retried[0]).toMatchObject({ deletionJobId, attemptCount: 2 });
    await expect(
      store.failDeletion({
        deletionJobId,
        workerId: "artifact-worker-2",
        attemptCount: 2,
        retryable: false,
        errorClass: "unsafe_path",
        errorMessage: "unsafe artifact path",
      }),
    ).resolves.toBe("dead_letter");

    expect(
      rows(
        await requireExecutor().query("select status, last_error_class from artifact_deletion_jobs where id = $1", [
          deletionJobId,
        ]),
      ),
    ).toEqual([{ status: "dead_letter", last_error_class: "unsafe_path" }]);
    expect(
      rows(
        await requireExecutor().query(
          `select event_type, subject_id, metadata
           from audit_events where event_type = 'artifact.object.deletion_failed' and subject_id = $1`,
          [artifactId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        event_type: "artifact.object.deletion_failed",
        subject_id: artifactId,
        metadata: expect.objectContaining({ errorClass: "unsafe_path", attemptCount: 2 }),
      }),
    ]);
  });
});
