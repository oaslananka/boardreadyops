import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../packages/db/src/control-plane-operations-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
const testPrefix = `lifecycle-reconcile-${randomUUID()}`;
const externalIdSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 11), 16);
let externalIdOffset = 0;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function at(offsetSeconds: number): Date {
  return new Date(Date.now() + offsetSeconds * 1000);
}

type TenantFixture = {
  installationId: string;
  installationExternalId: number;
  repositoryId: string;
  repositoryExternalId: number;
  repositoryFullName: string;
};

async function createTenant(label: string): Promise<TenantFixture> {
  externalIdOffset += 2;
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const installationExternalId = externalIdSeed + externalIdOffset;
  const repositoryExternalId = externalIdSeed + externalIdOffset + 1;
  const repositoryFullName = `${testPrefix}/${label}`;
  await database().query(
    `insert into installations (
       id, github_installation_id, account_login, account_type, plan_tier
     ) values ($1, $2::bigint, $3, 'Organization', 'enterprise')`,
    [installationId, installationExternalId, `${testPrefix}-${label}`],
  );
  await database().query(
    `insert into repositories (
       id, installation_id, github_repo_id, owner, name, private, default_branch
     ) values ($1, $2, $3::bigint, $4, $5, true, 'main')`,
    [repositoryId, installationId, repositoryExternalId, testPrefix, label],
  );
  return {
    installationId,
    installationExternalId,
    repositoryId,
    repositoryExternalId,
    repositoryFullName,
  };
}

async function insertInbox(
  tenant: TenantFixture | undefined,
  label: string,
  state: "accepted" | "processing" | "processed" | "dead_letter",
): Promise<string> {
  const inboxId = randomUUID();
  const observedAt = at(-600);
  const processingStartedAt = state === "accepted" ? null : observedAt.toISOString();
  const processedAt = state === "processed" || state === "dead_letter" ? observedAt.toISOString() : null;
  await database().query(
    `insert into webhook_inbox (
       id, provider, delivery_id, event_type, event_action,
       installation_external_id, repository_external_id, repository_full_name,
       payload_sha256, normalized_actions, state,
       received_at, last_received_at, accepted_at,
       processing_started_at, processed_at, retention_until
     ) values (
       $1, 'github', $2, 'push', null,
       $3::bigint, $4::bigint, $5,
       $6, $7::jsonb, $8,
       $9::timestamptz, $9::timestamptz, $9::timestamptz,
       $10::timestamptz, $11::timestamptz, $12::timestamptz
     )`,
    [
      inboxId,
      `${testPrefix}-${label}-${inboxId}`,
      tenant?.installationExternalId ?? externalIdSeed + 99_999,
      tenant?.repositoryExternalId ?? null,
      tenant?.repositoryFullName ?? null,
      "a".repeat(64),
      JSON.stringify([{ type: "installation.delete", installation: { id: tenant?.installationExternalId ?? 1 } }]),
      state,
      observedAt.toISOString(),
      processingStartedAt,
      processedAt,
      at(3600).toISOString(),
    ],
  );
  return inboxId;
}

async function insertJob(
  inboxId: string,
  label: string,
  status: "available" | "leased" | "completed" | "dead_letter",
): Promise<string> {
  const jobId = randomUUID();
  const observedAt = at(-540);
  const leased = status === "leased";
  const terminal = status === "completed" || status === "dead_letter";
  await database().query(
    `insert into control_plane_jobs (
       id, inbox_id, job_type, payload_version, idempotency_key,
       priority, status, available_at, attempt_count, max_attempts,
       lease_owner, lease_expires_at, created_at, started_at, completed_at,
       last_error_class, last_error_message
     ) values (
       $1, $2, 'github_webhook.lifecycle', 1, $3,
       100, $4, $5::timestamptz, $6, 8,
       $7, $8::timestamptz, $5::timestamptz, $9::timestamptz, $10::timestamptz,
       $11, $12
     )`,
    [
      jobId,
      inboxId,
      `${testPrefix}:${label}:${jobId}`,
      status,
      observedAt.toISOString(),
      status === "available" ? 0 : 1,
      leased ? `${testPrefix}-lease` : null,
      leased ? at(60).toISOString() : null,
      status === "available" ? null : observedAt.toISOString(),
      terminal ? observedAt.toISOString() : null,
      status === "dead_letter" ? "retry_exhausted" : null,
      status === "dead_letter" ? "Synthetic bounded failure." : null,
    ],
  );
  return jobId;
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from webhook_inbox where delivery_id like $1", [`${testPrefix}%`]);
  await executor.query("delete from installations where account_login like $1", [`${testPrefix}%`]);
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("control-plane lifecycle PostgreSQL reconciliation", () => {
  it("recreates a missing job once and records a tenant-scoped repair", async () => {
    const tenant = await createTenant("missing-job");
    const inboxId = await insertInbox(tenant, "missing-job", "accepted");
    await insertInbox(undefined, "unknown-installation", "accepted");
    const now = new Date();
    const workerId = `${testPrefix}-worker`;
    const store = createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 });

    await expect(
      store.detectLifecycleReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(1);
    await expect(
      store.detectLifecycleReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(0);

    const claimed = (await store.claimLifecycleReconciliationItems({ workerId, limit: 1 }))[0];
    if (!claimed) throw new Error("expected one lifecycle reconciliation item");
    expect(claimed).toMatchObject({
      installationId: tenant.installationId,
      repositoryId: tenant.repositoryId,
      subjectType: "webhook_inbox",
      subjectId: inboxId,
      reasonCode: "lifecycle_job_missing",
      attemptCount: 1,
    });
    await expect(
      store.applyLifecycleReconciliation({ reconciliationId: claimed.reconciliationId, workerId }),
    ).resolves.toBe("applied");

    expect(
      rows(
        await database().query(
          `select
             wi.state,
             cpj.status as job_status,
             cpj.attempt_count,
             cpj.idempotency_key,
             cpri.status as reconciliation_status,
             cpri.repaired,
             cpri.outcome_code
           from webhook_inbox wi
           join control_plane_jobs cpj on cpj.inbox_id = wi.id
           join control_plane_reconciliation_items cpri on cpri.subject_id = wi.id
          where wi.id = $1`,
          [inboxId],
        ),
      )[0],
    ).toEqual({
      state: "accepted",
      job_status: "available",
      attempt_count: 0,
      idempotency_key: `github:${testPrefix}-missing-job-${inboxId}`,
      reconciliation_status: "completed",
      repaired: true,
      outcome_code: "lifecycle_job_recreated",
    });
    await expect(store.collectSliSnapshot({ installationId: tenant.installationId })).resolves.toMatchObject({
      reconciliationRepairs24h: 1,
    });
  });

  it("projects every authoritative lifecycle-job status onto its inbox", async () => {
    const tenant = await createTenant("state-drift");
    const fixtures = [
      { status: "available" as const, initial: "processing" as const, expected: "accepted" },
      { status: "leased" as const, initial: "accepted" as const, expected: "processing" },
      { status: "completed" as const, initial: "accepted" as const, expected: "processed" },
      { status: "dead_letter" as const, initial: "accepted" as const, expected: "dead_letter" },
    ];
    const jobIds: string[] = [];
    for (const fixture of fixtures) {
      const inboxId = await insertInbox(tenant, fixture.status, fixture.initial);
      jobIds.push(await insertJob(inboxId, fixture.status, fixture.status));
    }
    const now = new Date();
    const workerId = `${testPrefix}-projection-worker`;
    const store = createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 });

    await expect(
      store.detectLifecycleReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(4);
    const claimed = await store.claimLifecycleReconciliationItems({ workerId, limit: 10 });
    expect(claimed).toHaveLength(4);
    expect(new Set(claimed.map((item) => item.subjectId))).toEqual(new Set(jobIds));
    await Promise.all(
      claimed.map((item) => store.applyLifecycleReconciliation({ reconciliationId: item.reconciliationId, workerId })),
    );

    const projected = rows(
      await database().query(
        `select cpj.status, wi.state, wi.processing_started_at, wi.processed_at,
                jsonb_array_length(wi.normalized_actions) as action_count,
                wi.last_error_class
           from control_plane_jobs cpj
           join webhook_inbox wi on wi.id = cpj.inbox_id
          where cpj.id = any($1::text[])
          order by cpj.status`,
        [jobIds],
      ),
    );
    expect(projected).toEqual([
      expect.objectContaining({
        status: "available",
        state: "accepted",
        processing_started_at: null,
        processed_at: null,
      }),
      expect.objectContaining({
        status: "completed",
        state: "processed",
        action_count: 0,
        last_error_class: null,
      }),
      expect.objectContaining({
        status: "dead_letter",
        state: "dead_letter",
        last_error_class: "retry_exhausted",
      }),
      expect.objectContaining({ status: "leased", state: "processing", processed_at: null }),
    ]);
  });

  it("converges a concurrently repaired item without creating another job", async () => {
    const tenant = await createTenant("convergence");
    const inboxId = await insertInbox(tenant, "convergence", "accepted");
    const now = new Date();
    const workerId = `${testPrefix}-convergence-worker`;
    const store = createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 });
    await store.detectLifecycleReconciliationCandidates({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1800,
      limit: 10,
    });
    const claimed = (await store.claimLifecycleReconciliationItems({ workerId, limit: 1 }))[0];
    if (!claimed) throw new Error("expected one lifecycle reconciliation item");
    await insertJob(inboxId, "concurrent", "available");

    await expect(
      store.applyLifecycleReconciliation({ reconciliationId: claimed.reconciliationId, workerId }),
    ).resolves.toBe("already_repaired");
    expect(
      rows(
        await database().query("select count(*)::int as count from control_plane_jobs where inbox_id = $1", [inboxId]),
      )[0],
    ).toEqual({ count: 1 });
    expect(
      rows(
        await database().query(
          "select status, repaired, outcome_code from control_plane_reconciliation_items where id = $1",
          [claimed.reconciliationId],
        ),
      )[0],
    ).toEqual({ status: "completed", repaired: false, outcome_code: "lifecycle_job_already_present" });
  });
});
