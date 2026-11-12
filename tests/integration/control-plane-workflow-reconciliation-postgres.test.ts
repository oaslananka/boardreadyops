import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../packages/db/src/control-plane-operations-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 6 }) : undefined;
const testPrefix = `workflow-reconcile-${randomUUID()}`;
const externalIdSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 11), 16);
let externalIdOffset = 0;

type RunStatus = "dispatched" | "running";
type AttemptStatus = "dispatched" | "in_progress";

type WorkflowFixture = {
  now: Date;
  staleAt: Date;
  installationId: string;
  repositoryId: string;
  releaseRunId: string;
  executionAttemptId: string;
  githubInstallationId: number;
  githubRepositoryId: number;
  store: ReturnType<typeof createSqlControlPlaneOperationsStore>;
};

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

async function createFixture(
  label: string,
  options: { runStatus?: RunStatus; attemptStatus?: AttemptStatus; now?: Date } = {},
): Promise<WorkflowFixture> {
  externalIdOffset += 2;
  const now = options.now ?? new Date("2026-07-27T16:00:00.000Z");
  const staleAt = new Date(now.valueOf() - 10 * 60 * 1000);
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const releaseRunId = randomUUID();
  const executionAttemptId = randomUUID();
  const githubInstallationId = externalIdSeed + externalIdOffset;
  const githubRepositoryId = externalIdSeed + externalIdOffset + 1;
  const runStatus = options.runStatus ?? "dispatched";
  const attemptStatus = options.attemptStatus ?? "dispatched";

  await database().query(
    `insert into installations (
       id, github_installation_id, account_login, account_type, plan_tier
     ) values ($1, $2::bigint, $3, 'Organization', 'enterprise')`,
    [installationId, githubInstallationId, `${testPrefix}-${label}`],
  );
  await database().query(
    `insert into repositories (
       id, installation_id, github_repo_id, owner, name, private, default_branch
     ) values ($1, $2, $3::bigint, 'octo-org', $4, true, 'main')`,
    [repositoryId, installationId, githubRepositoryId, `private-board-${label}`],
  );
  await database().query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind,
       status, started_at, execution_attempt_id, execution_attempt_started_at
     ) values (
       $1, $2, $3, $4, 'refs/heads/main', 'push',
       $5, $6::timestamptz, $7, $6::timestamptz
     )`,
    [
      releaseRunId,
      repositoryId,
      `${testPrefix}:${releaseRunId}`,
      "a".repeat(40),
      runStatus,
      staleAt.toISOString(),
      executionAttemptId,
    ],
  );
  await database().query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at,
       dispatch_requested_at, dispatched_at, started_at, heartbeat_at,
       github_workflow_dispatch_id
     ) values (
       $1, $2, 1, $3, $4::timestamptz,
       $4::timestamptz, $4::timestamptz,
       case when $3 = 'in_progress' then $4::timestamptz else null end,
       case when $3 = 'in_progress' then $4::timestamptz else null end,
       '987654321'
     )`,
    [executionAttemptId, releaseRunId, attemptStatus, staleAt.toISOString()],
  );

  return {
    now,
    staleAt,
    installationId,
    repositoryId,
    releaseRunId,
    executionAttemptId,
    githubInstallationId,
    githubRepositoryId,
    store: createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 }),
  };
}

async function detectAndClaim(fixture: WorkflowFixture, workerId: string) {
  await expect(
    fixture.store.detectWorkflowReconciliationCandidates({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1800,
      limit: 10,
    }),
  ).resolves.toBe(1);
  const claimed = (await fixture.store.claimWorkflowReconciliationItems({ workerId, limit: 1 }))[0];
  if (!claimed) throw new Error("expected one workflow reconciliation item");
  return claimed;
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("GitHub workflow PostgreSQL reconciliation", () => {
  it("detects, leases, reschedules, and guarded-terminalizes a missed callback", async () => {
    const fixture = await createFixture("successful");
    const workerId = `${testPrefix}-worker`;
    const claimed = await detectAndClaim(fixture, workerId);

    await expect(
      fixture.store.detectWorkflowReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(0);

    expect(claimed).toMatchObject({
      installationId: fixture.installationId,
      repositoryId: fixture.repositoryId,
      releaseRunId: fixture.releaseRunId,
      executionAttemptId: fixture.executionAttemptId,
      subjectType: "execution_attempt",
      subjectId: fixture.executionAttemptId,
      reasonCode: "callback_missing",
      attemptCount: 1,
    });
    expect(
      rows(
        await database().query(
          `select expected_run_status,
                  expected_run_version::int,
                  expected_attempt_status,
                  expected_attempt_version::int
             from control_plane_reconciliation_items
            where id = $1`,
          [claimed.reconciliationId],
        ),
      ),
    ).toEqual([
      {
        expected_run_status: "dispatched",
        expected_run_version: 0,
        expected_attempt_status: "dispatched",
        expected_attempt_version: 0,
      },
    ]);

    await expect(
      fixture.store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-other-worker`,
      }),
    ).resolves.toBeUndefined();
    await expect(
      fixture.store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId,
      }),
    ).resolves.toMatchObject({
      githubInstallationId: fixture.githubInstallationId,
      repositoryOwner: "octo-org",
      repositoryName: "private-board-successful",
      repositoryFullName: "octo-org/private-board-successful",
      githubWorkflowRunId: "987654321",
      attemptStatus: "dispatched",
    });

    const nextCheckAt = new Date(fixture.now.valueOf() + 1000);
    await expect(
      fixture.store.rescheduleReconciliationItem({
        reconciliationId: claimed.reconciliationId,
        workerId,
        nextCheckAt,
        outcomeCode: "github_workflow_in_progress",
      }),
    ).resolves.toBe("rescheduled");

    const secondNow = new Date(fixture.now.valueOf() + 2000);
    const secondWorkerId = `${testPrefix}-worker-2`;
    const secondStore = createSqlControlPlaneOperationsStore(database(), { now: () => secondNow, leaseSeconds: 60 });
    const secondClaim = await secondStore.claimWorkflowReconciliationItems({ workerId: secondWorkerId, limit: 1 });
    expect(secondClaim[0]?.reconciliationId).toBe(claimed.reconciliationId);

    await expect(
      secondStore.applyWorkflowReconciliation({
        reconciliationId: claimed.reconciliationId,
        workerId: secondWorkerId,
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
             rra.version::int as attempt_version,
             rra.failure_class,
             rr.status as run_status,
             rr.version::int as run_version,
             cpri.status as reconciliation_status,
             cpri.repaired,
             cpri.public_failure_reason,
             count(distinct ae.id)::int as audit_count,
             count(distinct rte.id)::int as transition_count
           from release_run_attempts rra
           join release_runs rr on rr.id = rra.run_id
           join control_plane_reconciliation_items cpri on cpri.execution_attempt_id = rra.id
           left join audit_events ae
             on ae.release_run_id = rr.id
            and ae.event_type = 'control_plane.github_workflow_reconciled'
           left join release_run_transition_events rte
             on rte.release_run_id = rr.id
            and rte.reason_code = 'github_workflow_reconciled'
          where rra.id = $1
          group by rra.status, rra.version, rra.failure_class, rr.status, rr.version,
                   cpri.status, cpri.repaired, cpri.public_failure_reason`,
          [fixture.executionAttemptId],
        ),
      )[0],
    ).toEqual({
      attempt_status: "failed",
      attempt_version: 1,
      failure_class: "github_result_callback_missing",
      run_status: "failed",
      run_version: 1,
      reconciliation_status: "completed",
      repaired: true,
      public_failure_reason: "github_result_callback_missing",
      audit_count: 1,
      transition_count: 2,
    });
  });

  it.each([
    ["run version", "update release_runs set version = version + 1 where id = $1"],
    ["attempt version", "update release_run_attempts set version = version + 1 where id = $1"],
    ["attempt status", "update release_run_attempts set status = 'in_progress' where id = $1"],
  ])("hides context when the %s drifts", async (_label, mutationSql) => {
    const fixture = await createFixture(`context-${String(_label).replaceAll(" ", "-")}`);
    const workerId = `${testPrefix}-context-${String(_label).replaceAll(" ", "-")}`;
    const claimed = await detectAndClaim(fixture, workerId);
    const targetId = _label === "run version" ? fixture.releaseRunId : fixture.executionAttemptId;

    await database().query(mutationSql, [targetId]);
    await expect(
      fixture.store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId,
      }),
    ).resolves.toBeUndefined();
  });

  it("hides context when the current-attempt pointer drifts", async () => {
    const fixture = await createFixture("context-pointer");
    const workerId = `${testPrefix}-context-pointer`;
    const claimed = await detectAndClaim(fixture, workerId);
    const replacementAttemptId = randomUUID();

    await database().query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at
       ) values ($1, $2, 2, 'dispatching', $3::timestamptz, $3::timestamptz)`,
      [replacementAttemptId, fixture.releaseRunId, fixture.now.toISOString()],
    );
    await database().query(
      `update release_runs
          set execution_attempt_id = $2,
              execution_attempt_started_at = $3::timestamptz
        where id = $1`,
      [fixture.releaseRunId, replacementAttemptId, fixture.now.toISOString()],
    );

    await expect(
      fixture.store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails closed when the run drifts after context load but before apply", async () => {
    const fixture = await createFixture("apply-stale");
    const workerId = `${testPrefix}-apply-stale`;
    const claimed = await detectAndClaim(fixture, workerId);

    await expect(
      fixture.store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId,
      }),
    ).resolves.toBeDefined();
    await database().query("update release_runs set version = version + 1 where id = $1", [fixture.releaseRunId]);

    await expect(
      fixture.store.applyWorkflowReconciliation({
        reconciliationId: claimed.reconciliationId,
        workerId,
        observedStatus: "completed",
        observedConclusion: "failure",
        terminalStatus: "failed",
        publicFailureReason: "github_workflow_failure",
      }),
    ).resolves.toBe("stale");

    expect(
      rows(
        await database().query(
          `select rr.status as run_status,
                  rr.version::int as run_version,
                  rra.status as attempt_status,
                  rra.version::int as attempt_version,
                  rra.failure_class,
                  cpri.status as reconciliation_status,
                  count(distinct ae.id)::int as audit_count,
                  count(distinct rte.id)::int as transition_count
             from release_runs rr
             join release_run_attempts rra on rra.run_id = rr.id
             join control_plane_reconciliation_items cpri on cpri.id = $2
             left join audit_events ae
               on ae.release_run_id = rr.id
              and ae.event_type = 'control_plane.github_workflow_reconciled'
             left join release_run_transition_events rte
               on rte.release_run_id = rr.id
              and rte.reason_code = 'github_workflow_reconciled'
            where rr.id = $1 and rra.id = $3
            group by rr.status, rr.version, rra.status, rra.version, rra.failure_class, cpri.status`,
          [fixture.releaseRunId, claimed.reconciliationId, fixture.executionAttemptId],
        ),
      )[0],
    ).toEqual({
      run_status: "dispatched",
      run_version: 1,
      attempt_status: "dispatched",
      attempt_version: 0,
      failure_class: null,
      reconciliation_status: "leased",
      audit_count: 0,
      transition_count: 0,
    });
  });

  it("completes an already-terminal callback race without duplicate transitions", async () => {
    const fixture = await createFixture("already-terminal", {
      runStatus: "running",
      attemptStatus: "in_progress",
    });
    const workerId = `${testPrefix}-already-terminal`;
    const claimed = await detectAndClaim(fixture, workerId);

    await expect(
      fixture.store.loadWorkflowReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId,
      }),
    ).resolves.toBeDefined();
    expect(
      rows(
        await database().query(
          `select transition_outcome
             from boardreadyops_transition_release_run_state(
               $1, 'running', 0, $2, 'completed', 'runner_result_received', $3::timestamptz,
               'in_progress', 0, 'completed'
             )`,
          [fixture.releaseRunId, fixture.executionAttemptId, fixture.now.toISOString()],
        ),
      )[0],
    ).toEqual({ transition_outcome: "applied" });

    await expect(
      fixture.store.applyWorkflowReconciliation({
        reconciliationId: claimed.reconciliationId,
        workerId,
        observedStatus: "completed",
        observedConclusion: "success",
        terminalStatus: "failed",
        publicFailureReason: "github_result_callback_missing",
      }),
    ).resolves.toBe("already_terminal");

    expect(
      rows(
        await database().query(
          `select rr.status as run_status,
                  rr.version::int as run_version,
                  rra.status as attempt_status,
                  rra.version::int as attempt_version,
                  cpri.status as reconciliation_status,
                  cpri.repaired,
                  cpri.public_failure_reason,
                  count(distinct ae.id)::int as audit_count,
                  count(distinct rte.id)::int as transition_count
             from release_runs rr
             join release_run_attempts rra on rra.run_id = rr.id
             join control_plane_reconciliation_items cpri on cpri.id = $2
             left join audit_events ae
               on ae.release_run_id = rr.id
              and ae.event_type = 'control_plane.github_workflow_reconciled'
             left join release_run_transition_events rte on rte.release_run_id = rr.id
            where rr.id = $1 and rra.id = $3
            group by rr.status, rr.version, rra.status, rra.version,
                     cpri.status, cpri.repaired, cpri.public_failure_reason`,
          [fixture.releaseRunId, claimed.reconciliationId, fixture.executionAttemptId],
        ),
      )[0],
    ).toEqual({
      run_status: "completed",
      run_version: 1,
      attempt_status: "completed",
      attempt_version: 1,
      reconciliation_status: "completed",
      repaired: false,
      public_failure_reason: null,
      audit_count: 1,
      transition_count: 2,
    });
  });

  it("keeps the detection snapshot and reconciliation identity immutable", async () => {
    const fixture = await createFixture("immutable");
    const workerId = `${testPrefix}-immutable`;
    const claimed = await detectAndClaim(fixture, workerId);

    await expect(
      database().query(
        `update control_plane_reconciliation_items
            set expected_run_version = expected_run_version + 1
          where id = $1`,
        [claimed.reconciliationId],
      ),
    ).rejects.toThrow(/workflow reconciliation snapshot is immutable/u);
    await expect(
      database().query(
        `update control_plane_reconciliation_items
            set reason_code = 'attempt_stale'
          where id = $1`,
        [claimed.reconciliationId],
      ),
    ).rejects.toThrow(/workflow reconciliation snapshot is immutable/u);

    expect(
      rows(
        await database().query(
          `select reason_code,
                  expected_run_status,
                  expected_run_version::int,
                  expected_attempt_status,
                  expected_attempt_version::int
             from control_plane_reconciliation_items
            where id = $1`,
          [claimed.reconciliationId],
        ),
      ),
    ).toEqual([
      {
        reason_code: "callback_missing",
        expected_run_status: "dispatched",
        expected_run_version: 0,
        expected_attempt_status: "dispatched",
        expected_attempt_version: 0,
      },
    ]);
  });

  it("does not exhaust the error budget for successful pending workflow observations", async () => {
    const fixture = await createFixture("pending-polls");
    await database().query("update release_runs set github_check_run_id = $2 where id = $1", [
      fixture.releaseRunId,
      externalIdSeed + 15,
    ]);
    const firstWorkerId = `${testPrefix}-worker-poll-0`;
    let claimed = await detectAndClaim(fixture, firstWorkerId);

    // The original 12-claim limit can run out before the authoritative 30-minute deadline,
    // even though every GitHub API observation succeeds and the runner callback is pending.
    for (let minute = 0; minute < 16; minute += 1) {
      const at = new Date(fixture.now.valueOf() + minute * 60_000);
      const workerId = minute === 0 ? firstWorkerId : `${testPrefix}-worker-poll-${minute}`;
      const store =
        minute === 0
          ? fixture.store
          : createSqlControlPlaneOperationsStore(database(), { now: () => at, leaseSeconds: 60 });
      if (minute > 0) {
        const next = (await store.claimWorkflowReconciliationItems({ workerId, limit: 1 }))[0];
        if (!next) throw new Error(`missing pending workflow observation ${minute}`);
        claimed = next;
      }
      expect(claimed.attemptCount).toBe(1);
      await expect(
        store.rescheduleReconciliationItem({
          reconciliationId: claimed.reconciliationId,
          workerId,
          nextCheckAt: new Date(at.valueOf() + 60_000),
          outcomeCode: "github_result_callback_pending",
        }),
      ).resolves.toBe("rescheduled");
      expect(
        rows(
          await database().query(
            `select status, attempt_count::int, completed_at is not null as completed
               from control_plane_reconciliation_items where id = $1`,
            [claimed.reconciliationId],
          ),
        ),
      ).toEqual([{ status: "available", attempt_count: 0, completed: false }]);
    }

    // At the actual deadline, the workflow's success without a signed callback is a
    // fail-closed operational failure, never an invented readiness PASS.
    const terminalAt = new Date(fixture.now.valueOf() + 21 * 60_000);
    const terminalStore = createSqlControlPlaneOperationsStore(database(), {
      now: () => terminalAt,
      leaseSeconds: 60,
    });
    const workerId = `${testPrefix}-worker-terminal`;
    const terminalClaim = (await terminalStore.claimWorkflowReconciliationItems({ workerId, limit: 1 }))[0];
    expect(terminalClaim?.reconciliationId).toBe(claimed.reconciliationId);
    await expect(
      terminalStore.applyWorkflowReconciliation({
        reconciliationId: claimed.reconciliationId,
        workerId,
        observedStatus: "completed",
        observedConclusion: "success",
        terminalStatus: "failed",
        publicFailureReason: "github_result_callback_missing",
      }),
    ).resolves.toBe("applied");
    expect(
      rows(
        await database().query(
          `select rr.status as run_status, rra.status as attempt_status,
                  rra.failure_class, cpri.status as reconciliation_status
             from release_runs rr
             join release_run_attempts rra on rra.run_id = rr.id
             join control_plane_reconciliation_items cpri on cpri.execution_attempt_id = rra.id
            where rr.id = $1`,
          [fixture.releaseRunId],
        ),
      ),
    ).toEqual([
      {
        run_status: "failed",
        attempt_status: "failed",
        failure_class: "github_result_callback_missing",
        reconciliation_status: "completed",
      },
    ]);

    // A terminal run with no signed result is eligible for the existing Check Run
    // recovery path, which publishes failure rather than leaving the PR pending.
    const checkAt = new Date(fixture.now.valueOf() + 27 * 60_000);
    const checkStore = createSqlControlPlaneOperationsStore(database(), { now: () => checkAt, leaseSeconds: 60 });
    await expect(
      checkStore.detectCheckRunReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(1);
    const checkWorkerId = `${testPrefix}-check-worker`;
    const checkClaim = (await checkStore.claimCheckRunReconciliationItems({ workerId: checkWorkerId, limit: 1 }))[0];
    expect(checkClaim?.releaseRunId).toBe(fixture.releaseRunId);
    await expect(
      checkStore.loadCheckRunReconciliationContext({
        reconciliationId: checkClaim?.reconciliationId ?? "",
        workerId: checkWorkerId,
      }),
    ).resolves.toMatchObject({ expectedConclusion: "failure", resultReported: false });
  });

  async function exhaustedLegacyCallback(label: string) {
    // This live incident is ten days old; keep the sample duration inside the
    // release_runs.duration_ms integer contract while retaining a pre-fix item.
    const fixture = await createFixture(label, { now: new Date(Date.now() - 10 * 24 * 60 * 60_000) });
    const checkRunId = externalIdSeed + externalIdOffset + 10_000;
    await database().query("update release_runs set github_check_run_id = $2 where id = $1", [
      fixture.releaseRunId,
      checkRunId,
    ]);
    const claimed = await detectAndClaim(fixture, `${testPrefix}-legacy-${label}`);
    await database().query(
      `update control_plane_reconciliation_items
          set status = 'dead_letter',
              attempt_count = max_attempts,
              lease_owner = null,
              lease_expires_at = null,
              completed_at = $2::timestamptz,
              created_at = $3::timestamptz,
              outcome_code = 'github_result_callback_pending',
              public_failure_reason = 'operator_replay_required'
        where id = $1`,
      [claimed.reconciliationId, fixture.now.toISOString(), fixture.staleAt.toISOString()],
    );
    return { fixture, reconciliationId: claimed.reconciliationId, checkRunId };
  }

  async function reactivateLegacy(input: {
    installationId: string;
    reconciliationId: string;
    checkRunId: number;
    workflowId?: string;
  }) {
    const response = await database().query(
      `select boardreadyops_reactivate_legacy_callback_dead_letter(
          $1, $2, $3, $4::bigint, $5
        ) as outcome`,
      [
        input.installationId,
        input.reconciliationId,
        input.workflowId ?? "987654321",
        input.checkRunId,
        "operator.recovery-test",
      ],
    );
    return rows(response)[0]?.outcome;
  }

  it("reactivates only a pre-fix dead letter, then fails closed using existing signed-callback reconciliation", async () => {
    const target = await exhaustedLegacyCallback("historic-current");
    await expect(
      reactivateLegacy({
        installationId: target.fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
      }),
    ).resolves.toBe("reactivated");

    const recoveryRow = rows(
      await database().query(
        `select status, attempt_count, completed_at, repaired, outcome_code
         from control_plane_reconciliation_items where id = $1`,
        [target.reconciliationId],
      ),
    )[0];
    expect(recoveryRow).toMatchObject({
      status: "available",
      attempt_count: 0,
      completed_at: null,
      repaired: false,
      outcome_code: "operator_legacy_callback_recovery",
    });

    const after = createSqlControlPlaneOperationsStore(database(), { now: () => new Date(), leaseSeconds: 60 });
    const workerId = `${testPrefix}-legacy-current-worker`;
    const claim = (await after.claimWorkflowReconciliationItems({ workerId, limit: 1 }))[0];
    expect(claim).toMatchObject({ reconciliationId: target.reconciliationId, attemptCount: 1 });
    await expect(
      after.loadWorkflowReconciliationContext({
        reconciliationId: target.reconciliationId,
        workerId,
      }),
    ).resolves.toMatchObject({
      githubWorkflowRunId: "987654321",
      releaseRunId: target.fixture.releaseRunId,
      executionAttemptId: target.fixture.executionAttemptId,
    });
    // The worker independently observes GitHub completed/success but has NO signed callback.
    // Its existing guarded transition MUST fail, never produce a readiness pass.
    await expect(
      after.applyWorkflowReconciliation({
        reconciliationId: target.reconciliationId,
        workerId,
        observedStatus: "completed",
        observedConclusion: "success",
        terminalStatus: "failed",
        publicFailureReason: "github_result_callback_missing",
      }),
    ).resolves.toBe("applied");

    const terminal = rows(
      await database().query(
        `select rr.status as run_status, ra.status as attempt_status,
              ra.failure_class, c.status as reconciliation_status,
              (select count(*)::int from release_run_results sr where sr.run_id = rr.id) as signed_results,
              (select count(*)::int from audit_events ae
                where ae.release_run_id = rr.id
                  and ae.event_type = 'control_plane.legacy_callback_reconciliation_reactivated') as operator_audit
         from release_runs rr
         join release_run_attempts ra on ra.id = rr.execution_attempt_id
         join control_plane_reconciliation_items c on c.execution_attempt_id = ra.id
        where rr.id = $1`,
        [target.fixture.releaseRunId],
      ),
    )[0];
    expect(terminal).toEqual({
      run_status: "failed",
      attempt_status: "failed",
      failure_class: "github_result_callback_missing",
      reconciliation_status: "completed",
      signed_results: 0,
      operator_audit: 1,
    });
    await expect(
      reactivateLegacy({
        installationId: target.fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
      }),
    ).resolves.toBe("not_recoverable");
  });

  it("rejects cross-tenant, wrong GitHub identity, and duplicate legacy recovery", async () => {
    const target = await exhaustedLegacyCallback("historic-scope");
    await expect(
      reactivateLegacy({
        installationId: randomUUID(),
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
      }),
    ).resolves.toBe("not_recoverable");
    await expect(
      reactivateLegacy({
        installationId: target.fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
        workflowId: "111111111",
      }),
    ).resolves.toBe("not_recoverable");
    await expect(
      reactivateLegacy({
        installationId: target.fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId + 1,
      }),
    ).resolves.toBe("not_recoverable");
    await expect(
      reactivateLegacy({
        installationId: target.fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
      }),
    ).resolves.toBe("reactivated");
    await expect(
      reactivateLegacy({
        installationId: target.fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
      }),
    ).resolves.toBe("not_recoverable");
    const events = rows(
      await database().query(
        `select count(*)::int as count from audit_events
        where release_run_id=$1 and event_type='control_plane.legacy_callback_reconciliation_reactivated'`,
        [target.fixture.releaseRunId],
      ),
    );
    expect(events[0]?.count).toBe(1);
  });

  it.each([
    "suspended",
    "disabled",
    "run-version-drift",
    "attempt-version-drift",
    "signed-result",
    "newer-than-fix",
    "too-old-to-terminalize",
  ])("refuses recovery when the subject is %s", async (variant) => {
    const target = await exhaustedLegacyCallback(`guard-${variant}`);
    const { fixture } = target;
    if (variant === "suspended") {
      await database().query("update installations set suspended_at=now() where id=$1", [fixture.installationId]);
    } else if (variant === "disabled") {
      await database().query("update repositories set disabled_at=now() where id=$1", [fixture.repositoryId]);
    } else if (variant === "run-version-drift") {
      await database().query("update release_runs set version=version+1 where id=$1", [fixture.releaseRunId]);
    } else if (variant === "attempt-version-drift") {
      await database().query("update release_run_attempts set version=version+1 where id=$1", [
        fixture.executionAttemptId,
      ]);
    } else if (variant === "too-old-to-terminalize") {
      await database().query("update release_runs set started_at=now()-interval '30 days' where id=$1", [
        fixture.releaseRunId,
      ]);
    } else if (variant === "signed-result") {
      await database().query("update release_runs set terminal_result_digest=$2 where id=$1", [
        fixture.releaseRunId,
        "a".repeat(64),
      ]);
    } else if (variant === "newer-than-fix") {
      await database().query("update control_plane_reconciliation_items set created_at=now() where id=$1", [
        target.reconciliationId,
      ]);
    }
    await expect(
      reactivateLegacy({
        installationId: fixture.installationId,
        reconciliationId: target.reconciliationId,
        checkRunId: target.checkRunId,
      }),
    ).resolves.toBe("not_recoverable");
    expect(
      rows(
        await database().query("select status from control_plane_reconciliation_items where id=$1", [
          target.reconciliationId,
        ]),
      )[0]?.status,
    ).toBe("dead_letter");
  });

  it("keeps claiming while an exhausted item sits on the queue", async () => {
    // The regression this guards. An exhausted item left at 'available' made the claim attempt
    // attempt_count + 1, which violates control_plane_reconciliation_attempts_valid. Postgres
    // aborts the whole statement, so every other waiting item stopped being claimed too and the
    // worker crash-looped.
    const poisoned = await createFixture("poisoned");
    const poisonedClaim = await detectAndClaim(poisoned, `${testPrefix}-worker-poisoned`);
    await database().query(
      `update control_plane_reconciliation_items
          set status = 'available', attempt_count = max_attempts,
              lease_owner = null, lease_expires_at = null
        where id = $1`,
      [poisonedClaim.reconciliationId],
    );

    const healthy = await createFixture("healthy");
    await expect(
      healthy.store.detectWorkflowReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(1);

    const claimed = await healthy.store.claimWorkflowReconciliationItems({
      workerId: `${testPrefix}-worker-healthy`,
      limit: 10,
    });

    expect(claimed.map((item) => item.reconciliationId)).not.toContain(poisonedClaim.reconciliationId);
    expect(claimed.length).toBeGreaterThan(0);
  });
});
