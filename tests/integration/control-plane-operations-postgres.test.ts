import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../packages/db/src/control-plane-operations-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
const testPrefix = `operations-test-${randomUUID()}`;
const externalIdSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
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

function operations(now: Date, leaseSeconds = 60) {
  return createSqlControlPlaneOperationsStore(database(), {
    now: () => now,
    leaseSeconds,
    retryBaseSeconds: 1,
  });
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
     ) values ($1, $2, $3::bigint, $4, $5, false, 'main')`,
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

async function createReleaseRun(tenant: TenantFixture): Promise<string> {
  const runId = randomUUID();
  await database().query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind, status, started_at
     ) values ($1, $2, $3, $4, 'refs/heads/main', 'push', 'queued', now())`,
    [runId, tenant.repositoryId, `${testPrefix}:${runId}`, "a".repeat(40)],
  );
  return runId;
}

async function createDeadLetterJob(tenant: TenantFixture): Promise<string> {
  const inboxId = randomUUID();
  const jobId = randomUUID();
  const completedAt = at(-10);
  await database().query(
    `insert into webhook_inbox (
       id, provider, delivery_id, event_type,
       installation_external_id, repository_external_id, repository_full_name,
       payload_sha256, normalized_actions, state,
       received_at, last_received_at, processed_at, retention_until
     ) values (
       $1, 'github', $2, 'push',
       $3::bigint, $4::bigint, $5,
       $6, '[]'::jsonb, 'dead_letter',
       $7::timestamptz, $7::timestamptz, $7::timestamptz, $8::timestamptz
     )`,
    [
      inboxId,
      `${testPrefix}-${inboxId}`,
      tenant.installationExternalId,
      tenant.repositoryExternalId,
      tenant.repositoryFullName,
      "b".repeat(64),
      completedAt.toISOString(),
      at(3600).toISOString(),
    ],
  );
  await database().query(
    `insert into control_plane_jobs (
       id, inbox_id, job_type, idempotency_key, status,
       available_at, attempt_count, max_attempts, created_at, completed_at,
       last_error_class, last_error_message
     ) values (
       $1, $2, 'github_webhook.lifecycle', $3, 'dead_letter',
       $4::timestamptz, 8, 8, $4::timestamptz, $4::timestamptz,
       'retry_exhausted', 'Synthetic bounded failure.'
     )`,
    [jobId, inboxId, `${testPrefix}:${jobId}`, completedAt.toISOString()],
  );
  return jobId;
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where account_login like $1", [`${testPrefix}%`]);
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("control-plane PostgreSQL reconciliation operations", () => {
  it("keeps dead-letter listing and replay tenant-scoped and idempotent", async () => {
    const tenant = await createTenant("tenant-a");
    const otherTenant = await createTenant("tenant-b");
    const jobId = await createDeadLetterJob(tenant);
    const now = at(0);
    const store = operations(now);

    await expect(store.listDeadLetters({ installationId: otherTenant.installationId })).resolves.toEqual([]);
    await expect(
      store.replayDeadLetter({
        installationId: otherTenant.installationId,
        itemType: "job",
        itemId: jobId,
        operationId: randomUUID(),
        actorId: "operator-b",
      }),
    ).resolves.toEqual({ outcome: "not_found" });

    await expect(store.listDeadLetters({ installationId: tenant.installationId })).resolves.toEqual([
      expect.objectContaining({
        itemType: "job",
        itemId: jobId,
        installationId: tenant.installationId,
        repositoryId: tenant.repositoryId,
        reasonCode: "retry_exhausted",
        replaySafe: true,
      }),
    ]);

    const operationId = randomUUID();
    const first = await store.replayDeadLetter({
      installationId: tenant.installationId,
      itemType: "job",
      itemId: jobId,
      operationId,
      actorId: "operator-a",
    });
    expect(first).toMatchObject({ outcome: "replayed" });
    expect(first.auditEventId).toBeTruthy();
    await expect(
      store.replayDeadLetter({
        installationId: tenant.installationId,
        itemType: "job",
        itemId: jobId,
        operationId,
        actorId: "operator-a",
      }),
    ).resolves.toEqual({ outcome: "already_applied", auditEventId: first.auditEventId });

    const state = rows(
      await database().query("select status, attempt_count from control_plane_jobs where id = $1", [jobId]),
    )[0];
    expect(state).toEqual({ status: "available", attempt_count: 0 });
    const audit = rows(
      await database().query("select count(*)::int as count from audit_events where request_id = $1", [operationId]),
    )[0];
    expect(audit).toEqual({ count: 1 });
  });

  it("never replays a workflow dispatch with uncertain delivery", async () => {
    const tenant = await createTenant("uncertain-dispatch");
    const runId = await createReleaseRun(tenant);
    const outboxId = randomUUID();
    const now = at(0);
    await database().query(
      `insert into control_plane_outbox (
         id, release_run_id, effect_type, idempotency_key, payload,
         status, available_at, attempt_count, max_attempts, created_at,
         delivery_started_at, completed_at, last_error_class, last_error_message
       ) values (
         $1, $2, 'github.workflow.dispatch', $3,
         jsonb_build_object('version', 1, 'type', 'github.workflow.dispatch', 'input', '{}'::jsonb),
         'reconciliation_required', $4::timestamptz, 1, 8, $4::timestamptz,
         $4::timestamptz, $4::timestamptz, 'delivery_uncertain',
         'Delivery started but the authoritative workflow state is unknown.'
       )`,
      [outboxId, runId, `${testPrefix}:${outboxId}`, now.toISOString()],
    );

    const operationId = randomUUID();
    await expect(
      operations(now).replayDeadLetter({
        installationId: tenant.installationId,
        itemType: "outbox",
        itemId: outboxId,
        operationId,
        actorId: "operator-a",
      }),
    ).resolves.toEqual({ outcome: "not_replayable" });

    const state = rows(await database().query("select status from control_plane_outbox where id = $1", [outboxId]))[0];
    expect(state).toEqual({ status: "reconciliation_required" });
    const replay = rows(
      await database().query(
        `select outcome from control_plane_replay_operations
          where installation_id = $1 and operation_id = $2`,
        [tenant.installationId, operationId],
      ),
    )[0];
    expect(replay).toEqual({ outcome: "not_replayable" });
  });

  it("dead-letters reconciliation work after an expired final lease", async () => {
    const tenant = await createTenant("lease-expiry");
    const runId = await createReleaseRun(tenant);
    const reconciliationId = randomUUID();
    const claimedAt = at(0);
    const store = operations(claimedAt, 1);

    await expect(
      store.enqueueReconciliationItem({
        reconciliationId,
        installationId: tenant.installationId,
        repositoryId: tenant.repositoryId,
        releaseRunId: runId,
        subjectType: "release_run",
        subjectId: runId,
        reasonCode: "callback_missing",
        deadlineAt: at(60),
        nextCheckAt: claimedAt,
        maximumAttempts: 1,
      }),
    ).resolves.toBe("enqueued");
    await expect(store.claimReconciliationItems({ workerId: `${testPrefix}-worker`, limit: 1 })).resolves.toEqual([
      expect.objectContaining({ reconciliationId, attemptCount: 1, reasonCode: "callback_missing" }),
    ]);

    await expect(
      operations(new Date(claimedAt.valueOf() + 2000), 1).claimReconciliationItems({
        workerId: `${testPrefix}-recovery-worker`,
      }),
    ).resolves.toEqual([]);

    const state = rows(
      await database().query(
        `select status, public_failure_reason, completed_at is not null as terminal
           from control_plane_reconciliation_items where id = $1`,
        [reconciliationId],
      ),
    )[0];
    expect(state).toEqual({
      status: "dead_letter",
      public_failure_reason: "operator_replay_required",
      terminal: true,
    });
  });
});
