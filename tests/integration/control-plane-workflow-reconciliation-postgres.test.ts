import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../packages/db/src/control-plane-operations-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const testPrefix = `workflow-reconcile-${randomUUID()}`;
const externalIdSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 11), 16);

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
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

describeDatabase("GitHub workflow PostgreSQL reconciliation", () => {
  it("detects, leases, reschedules, and atomically terminalizes a missed callback", async () => {
    const now = new Date();
    const staleAt = new Date(now.valueOf() - 10 * 60 * 1000);
    const installationId = randomUUID();
    const repositoryId = randomUUID();
    const releaseRunId = randomUUID();
    const executionAttemptId = randomUUID();
    const githubInstallationId = externalIdSeed + 1;
    const githubRepositoryId = externalIdSeed + 2;

    await database().query(
      `insert into installations (
         id, github_installation_id, account_login, account_type, plan_tier
       ) values ($1, $2::bigint, $3, 'Organization', 'enterprise')`,
      [installationId, githubInstallationId, `${testPrefix}-tenant`],
    );
    await database().query(
      `insert into repositories (
         id, installation_id, github_repo_id, owner, name, private, default_branch
       ) values ($1, $2, $3::bigint, 'octo-org', 'private-board', true, 'main')`,
      [repositoryId, installationId, githubRepositoryId],
    );
    await database().query(
      `insert into release_runs (
         id, repository_id, idempotency_key, commit_sha, ref, trigger_kind,
         status, started_at, execution_attempt_id, execution_attempt_started_at
       ) values (
         $1, $2, $3, $4, 'refs/heads/main', 'push',
         'dispatched', $5::timestamptz, $6, $5::timestamptz
       )`,
      [
        releaseRunId,
        repositoryId,
        `${testPrefix}:${releaseRunId}`,
        "a".repeat(40),
        staleAt.toISOString(),
        executionAttemptId,
      ],
    );
    await database().query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at,
         dispatch_requested_at, dispatched_at, github_workflow_dispatch_id
       ) values (
         $1, $2, 1, 'dispatched', $3::timestamptz,
         $3::timestamptz, $3::timestamptz, '987654321'
       )`,
      [executionAttemptId, releaseRunId, staleAt.toISOString()],
    );

    const store = createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 });
    await expect(
      store.detectWorkflowReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(1);
    await expect(
      store.detectWorkflowReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(0);

    const firstClaim = await store.claimWorkflowReconciliationItems({ workerId: `${testPrefix}-worker`, limit: 1 });
    expect(firstClaim).toHaveLength(1);
    const claimed = firstClaim[0];
    if (!claimed) throw new Error("expected one workflow reconciliation item");
    expect(claimed).toMatchObject({
      installationId,
      repositoryId,
      releaseRunId,
      executionAttemptId,
      subjectType: "execution_attempt",
      subjectId: executionAttemptId,
      reasonCode: "callback_missing",
      attemptCount: 1,
    });

    await expect(
      store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-other-worker`,
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-worker`,
      }),
    ).resolves.toMatchObject({
      githubInstallationId,
      repositoryOwner: "octo-org",
      repositoryName: "private-board",
      repositoryFullName: "octo-org/private-board",
      githubWorkflowRunId: "987654321",
      attemptStatus: "dispatched",
    });

    const nextCheckAt = new Date(now.valueOf() + 1000);
    await expect(
      store.rescheduleReconciliationItem({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-worker`,
        nextCheckAt,
        outcomeCode: "github_workflow_in_progress",
      }),
    ).resolves.toBe("rescheduled");

    const secondNow = new Date(now.valueOf() + 2000);
    const secondStore = createSqlControlPlaneOperationsStore(database(), { now: () => secondNow, leaseSeconds: 60 });
    const secondClaim = await secondStore.claimWorkflowReconciliationItems({
      workerId: `${testPrefix}-worker-2`,
      limit: 1,
    });
    expect(secondClaim[0]?.reconciliationId).toBe(claimed.reconciliationId);

    await expect(
      secondStore.applyWorkflowReconciliation({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-worker-2`,
        observedStatus: "completed",
        observedConclusion: "success",
        terminalStatus: "failed",
        publicFailureReason: "github_result_callback_missing",
      }),
    ).resolves.toBe("applied");

    expect(
      rows(
        await database().query(
          `select
             rra.status as attempt_status,
             rra.failure_class,
             rr.status as run_status,
             cpri.status as reconciliation_status,
             cpri.repaired,
             cpri.public_failure_reason,
             count(ae.id)::int as audit_count
           from release_run_attempts rra
           join release_runs rr on rr.id = rra.run_id
           join control_plane_reconciliation_items cpri on cpri.execution_attempt_id = rra.id
           left join audit_events ae
             on ae.release_run_id = rr.id
            and ae.event_type = 'control_plane.github_workflow_reconciled'
          where rra.id = $1
          group by rra.status, rra.failure_class, rr.status, cpri.status, cpri.repaired, cpri.public_failure_reason`,
          [executionAttemptId],
        ),
      )[0],
    ).toEqual({
      attempt_status: "failed",
      failure_class: "github_result_callback_missing",
      run_status: "failed",
      reconciliation_status: "completed",
      repaired: true,
      public_failure_reason: "github_result_callback_missing",
      audit_count: 1,
    });
  });
});
