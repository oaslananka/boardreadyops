import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlControlPlaneOutboxStore } from "../../packages/db/src/control-plane-outbox-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlTransactionalGitHubAppLifecycleStore } from "../../packages/db/src/transactional-lifecycle-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const numericSuffix = Number.parseInt(suffix.slice(0, 8), 16);
const installationRowId = `producer-installation-${suffix}`;
const repositoryRowId = `producer-repository-${suffix}`;
const githubInstallationId = 7_000_000_000 + numericSuffix;
const githubRepositoryId = 8_000_000_000 + numericSuffix;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function action(commitSha: string) {
  return {
    type: "release_run.enqueue" as const,
    installation: { id: githubInstallationId },
    repository: {
      id: githubRepositoryId,
      owner: "octo",
      name: `board-${suffix}`,
      fullName: `octo/board-${suffix}`,
      private: false,
      defaultBranch: "main",
    },
    pullRequestNumber: 42,
    ref: "refs/pull/42/head",
    commitSha,
    triggerKind: "pr" as const,
  };
}

type ReleaseAction = ReturnType<typeof action> & {
  pullRequestDraft?: boolean;
  pullRequestFromFork?: boolean;
  safeMode?: {
    enabled: boolean;
    reasons: ("draft-pull-request" | "fork-pull-request" | "private-repository")[];
  };
};

function idSequence(values: string[]): () => string {
  return () => values.shift() ?? `unexpected-${randomUUID()}`;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [installationRowId]);
}

async function prepareCheckRunCreate(label: string, releaseAction: ReleaseAction, leaseSeconds = 60) {
  const plannedAt = new Date("2026-07-22T02:30:00.000Z");
  const runId = `run-${label}-${suffix}`;
  const createOutboxId = `outbox-${label}-create-${suffix}`;
  const workerId = `${label}-create-worker-${suffix}`;
  const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(database(), {
    id: idSequence([runId, createOutboxId]),
    now: () => plannedAt,
    releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
  });
  await lifecycle.enqueueReleaseRunWithOutbox(releaseAction);
  const store = createSqlControlPlaneOutboxStore(database(), {
    now: () => plannedAt,
    leaseSeconds,
  });
  const effect = (await store.claimEffects({ workerId }))[0];
  if (!effect) throw new Error("expected Check Run creation effect");
  return { plannedAt, runId, createOutboxId, workerId, store, effect };
}

async function prepareWorkflowDispatch(label: string, commitSha: string, leaseSeconds = 60) {
  const plannedAt = new Date("2026-07-22T05:00:00.000Z");
  const runId = `run-${label}-${suffix}`;
  const createOutboxId = `outbox-${label}-create-${suffix}`;
  const executionAttemptId = randomUUID();
  const dispatchOutboxId = `outbox-${label}-dispatch-${suffix}`;
  const createWorkerId = `${label}-create-worker-${suffix}`;
  const dispatchWorkerId = `${label}-dispatch-worker-${suffix}`;
  const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(database(), {
    id: idSequence([runId, createOutboxId]),
    now: () => plannedAt,
    releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
  });
  await lifecycle.enqueueReleaseRunWithOutbox(action(commitSha));

  const createStore = createSqlControlPlaneOutboxStore(database(), {
    now: () => plannedAt,
    leaseSeconds: 60,
  });
  const createEffect = (await createStore.claimEffects({ workerId: createWorkerId }))[0];
  if (!createEffect) throw new Error("expected Check Run creation effect");
  await createStore.completeCheckRunCreateEffect({
    effect: createEffect,
    workerId: createWorkerId,
    githubCheckRunId: 900000,
    dispatchMode: "github-actions",
    executionAttemptId,
    nextOutboxId: dispatchOutboxId,
  });

  const dispatchAt = new Date(plannedAt.valueOf() + 1000);
  const dispatchStore = createSqlControlPlaneOutboxStore(database(), {
    now: () => dispatchAt,
    leaseSeconds,
  });
  const dispatchEffect = (await dispatchStore.claimEffects({ workerId: dispatchWorkerId })).find(
    (effect) => effect.outboxId === dispatchOutboxId,
  );
  if (!dispatchEffect) throw new Error("expected workflow dispatch effect");

  return {
    runId,
    executionAttemptId,
    dispatchOutboxId,
    dispatchWorkerId,
    dispatchAt,
    dispatchStore,
    dispatchEffect,
  };
}

beforeEach(async () => {
  await cleanup();
  await database().query(
    `insert into installations (
       id, github_installation_id, account_login, account_type, created_at, suspended_at
     ) values ($1, $2, 'octo', 'Organization', now(), null)`,
    [installationRowId, githubInstallationId],
  );
  await database().query(
    `insert into repositories (
       id, installation_id, github_repo_id, owner, name, private,
       default_branch, enabled_at, disabled_at
     ) values ($1, $2, $3, 'octo', $4, false, 'main', now(), null)`,
    [repositoryRowId, installationRowId, githubRepositoryId, `board-${suffix}`],
  );
});

afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("transactional release-run outbox producer", () => {
  it("converges concurrent replay to one release run and one Check Run effect", async () => {
    const firstStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-first-${suffix}`, `outbox-first-${suffix}`]),
      now: () => new Date("2026-07-22T02:00:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const secondStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-replay-${suffix}`, `outbox-replay-${suffix}`]),
      now: () => new Date("2026-07-22T02:01:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const [first, replay] = await Promise.all([
      firstStore.enqueueReleaseRunWithOutbox(action("a".repeat(40))),
      secondStore.enqueueReleaseRunWithOutbox(action("a".repeat(40))),
    ]);

    expect(replay).toEqual(first);
    expect(first.status).toBe("queued");
    expect([`run-first-${suffix}`, `run-replay-${suffix}`]).toContain(first.runId);
    expect([`outbox-first-${suffix}`, `outbox-replay-${suffix}`]).toContain(first.outboxId);

    const state = await database().query(
      `select
         (select count(*)::int from release_runs where repository_id = $1) as run_count,
         (select count(*)::int from control_plane_outbox where release_run_id = $2) as outbox_count,
         (select payload ->> 'runId' from control_plane_outbox where release_run_id = $2) as payload_run_id,
         (select idempotency_key from control_plane_outbox where release_run_id = $2) as outbox_key,
         (select count(*)::int from release_run_transition_events where release_run_id = $2)
           as transition_events`,
      [repositoryRowId, first.runId],
    );
    expect(rows(state)[0]).toEqual({
      run_count: 1,
      outbox_count: 1,
      payload_run_id: first.runId,
      outbox_key: `github.check_run.create:${first.runId}`,
      transition_events: 0,
    });
  });

  it("persists the source webhook delivery id for traceability, and leaves it null when absent", async () => {
    const withDeliveryStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-delivery-${suffix}`, `outbox-delivery-${suffix}`]),
      now: () => new Date("2026-07-22T02:02:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const withDelivery = await withDeliveryStore.enqueueReleaseRunWithOutbox({
      ...action("b".repeat(40)),
      deliveryId: "delivery-abc-123",
    });

    const noDeliveryStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-no-delivery-${suffix}`, `outbox-no-delivery-${suffix}`]),
      now: () => new Date("2026-07-22T02:03:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const withoutDelivery = await noDeliveryStore.enqueueReleaseRunWithOutbox(action("c".repeat(40)));

    const state = await database().query(`select id, delivery_id from release_runs where id in ($1, $2)`, [
      withDelivery.runId,
      withoutDelivery.runId,
    ]);
    const deliveryById = new Map(rows(state).map((row) => [row.id, row.delivery_id]));
    expect(deliveryById.get(withDelivery.runId)).toBe("delivery-abc-123");
    expect(deliveryById.get(withoutDelivery.runId)).toBeNull();
  });

  it("persists and audits one immutable safe-mode trust snapshot across webhook replay", async () => {
    const safeAction: ReleaseAction = {
      ...action("9".repeat(40)),
      pullRequestFromFork: true,
      safeMode: { enabled: true, reasons: ["fork-pull-request"] },
    };
    const firstStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-safe-${suffix}`, `outbox-safe-${suffix}`]),
      now: () => new Date("2026-07-22T02:05:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const replayStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-safe-replay-${suffix}`, `outbox-safe-replay-${suffix}`]),
      now: () => new Date("2026-07-22T02:06:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const first = await firstStore.enqueueReleaseRunWithOutbox(safeAction);
    const replay = await replayStore.enqueueReleaseRunWithOutbox(safeAction);
    expect(replay).toEqual(first);

    const state = rows(
      await database().query(
        `select release_runs.trust_mode,
                release_runs.safe_mode_reasons,
                (select count(*)::int
                   from audit_events
                  where audit_events.release_run_id = release_runs.id
                    and audit_events.event_type = 'release_run.trust_mode_selected') as audit_count,
                (select metadata
                   from audit_events
                  where audit_events.release_run_id = release_runs.id
                    and audit_events.event_type = 'release_run.trust_mode_selected') as audit_metadata
           from release_runs
          where release_runs.id = $1`,
        [first.runId],
      ),
    )[0];

    expect(state).toEqual({
      trust_mode: "safe",
      safe_mode_reasons: ["fork-pull-request"],
      audit_count: 1,
      audit_metadata: { trustMode: "safe", safeModeReasons: ["fork-pull-request"] },
    });
  });

  it("increments the previous run version and records one scoped supersession event", async () => {
    const store = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-old-${suffix}`, `outbox-old-${suffix}`, `run-new-${suffix}`, `outbox-new-${suffix}`]),
      now: () => new Date("2026-07-22T02:10:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const previous = await store.enqueueReleaseRunWithOutbox(action("b".repeat(40)));
    const current = await store.enqueueReleaseRunWithOutbox(action("c".repeat(40)));
    const result = await database().query(
      `select release_runs.id,
              release_runs.status,
              release_runs.version::int as version,
              (select count(*)::int
                 from release_run_transition_events
                where release_run_id = release_runs.id) as transition_events,
              (select reason_code
                 from release_run_transition_events
                where release_run_id = release_runs.id
                  and entity_type = 'release_run') as reason_code,
              (select installation_id
                 from release_run_transition_events
                where release_run_id = release_runs.id
                  and entity_type = 'release_run') as event_installation_id,
              (select repository_id
                 from release_run_transition_events
                where release_run_id = release_runs.id
                  and entity_type = 'release_run') as event_repository_id
         from release_runs
        where release_runs.id = any($1::text[])
        order by release_runs.id`,
      [[previous.runId, current.runId]],
    );

    expect(rows(result)).toEqual([
      {
        id: `run-new-${suffix}`,
        status: "queued",
        version: 0,
        transition_events: 0,
        reason_code: null,
        event_installation_id: null,
        event_repository_id: null,
      },
      {
        id: `run-old-${suffix}`,
        status: "superseded",
        version: 1,
        transition_events: 1,
        reason_code: "newer_commit",
        event_installation_id: installationRowId,
        event_repository_id: repositoryRowId,
      },
    ]);
  });

  it("supersedes every nonterminal attempt with one versioned event while retaining the current pointer", async () => {
    const store = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([
        `run-attempts-old-${suffix}`,
        `outbox-attempts-old-${suffix}`,
        `run-attempts-new-${suffix}`,
        `outbox-attempts-new-${suffix}`,
      ]),
      now: () => new Date("2026-07-22T02:20:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const previous = await store.enqueueReleaseRunWithOutbox(action("d".repeat(40)));
    const firstAttemptId = randomUUID();
    const currentAttemptId = randomUUID();

    await database().query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at, started_at, heartbeat_at
       ) values
         ($1, $3, 1, 'dispatching', $4::timestamptz, $4::timestamptz, null, null),
         ($2, $3, 2, 'in_progress', $4::timestamptz, $4::timestamptz, $4::timestamptz, $4::timestamptz)`,
      [firstAttemptId, currentAttemptId, previous.runId, "2026-07-22T02:19:00.000Z"],
    );
    await database().query(
      `update release_runs
          set status = 'running',
              execution_attempt_id = $2,
              execution_attempt_started_at = $3::timestamptz
        where id = $1`,
      [previous.runId, currentAttemptId, "2026-07-22T02:19:00.000Z"],
    );

    await store.enqueueReleaseRunWithOutbox(action("e".repeat(40)));

    expect(
      rows(
        await database().query(
          `select status,
                  version::int as version,
                  execution_attempt_id,
                  (select count(*)::int
                     from release_run_transition_events
                    where release_run_id = release_runs.id
                      and entity_type = 'release_run') as run_events,
                  (select count(*)::int
                     from release_run_transition_events
                    where release_run_id = release_runs.id
                      and entity_type = 'execution_attempt') as attempt_events
             from release_runs
            where id = $1`,
          [previous.runId],
        ),
      )[0],
    ).toEqual({
      status: "superseded",
      version: 1,
      execution_attempt_id: currentAttemptId,
      run_events: 1,
      attempt_events: 2,
    });

    expect(
      rows(
        await database().query(
          `select id,
                  status,
                  version::int as version,
                  failure_class,
                  failure_message,
                  completed_at is not null as completed
             from release_run_attempts
            where run_id = $1
            order by attempt_number`,
          [previous.runId],
        ),
      ),
    ).toEqual([
      {
        id: firstAttemptId,
        status: "superseded",
        version: 1,
        failure_class: "newer_commit",
        failure_message: "A newer commit superseded this execution attempt.",
        completed: true,
      },
      {
        id: currentAttemptId,
        status: "superseded",
        version: 1,
        failure_class: "newer_commit",
        failure_message: "A newer commit superseded this execution attempt.",
        completed: true,
      },
    ]);
  });

  it("serializes concurrent different commits to one active run with run-bound outbox payloads", async () => {
    const firstStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-concurrent-a-${suffix}`, `outbox-concurrent-a-${suffix}`]),
      now: () => new Date("2026-07-22T02:30:00.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const secondStore = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([`run-concurrent-b-${suffix}`, `outbox-concurrent-b-${suffix}`]),
      now: () => new Date("2026-07-22T02:30:01.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });

    const results = await Promise.all([
      firstStore.enqueueReleaseRunWithOutbox(action("f".repeat(40))),
      secondStore.enqueueReleaseRunWithOutbox(action("1".repeat(40))),
    ]);
    const runIds = results.map((result) => result.runId);

    const state = rows(
      await database().query(
        `select release_runs.id,
                release_runs.status,
                release_runs.version::int as version,
                control_plane_outbox.id as outbox_id,
                control_plane_outbox.payload ->> 'runId' as payload_run_id,
                control_plane_outbox.idempotency_key as outbox_key,
                (select count(*)::int
                   from release_run_attempts
                  where run_id = release_runs.id
                    and status in ('queued', 'dispatching', 'dispatched', 'in_progress', 'uploading_artifacts', 'reporting'))
                  as active_attempts,
                (select count(*)::int
                   from release_run_transition_events
                  where release_run_id = release_runs.id
                    and entity_type = 'release_run') as run_events
           from release_runs
           join control_plane_outbox on control_plane_outbox.release_run_id = release_runs.id
          where release_runs.id = any($1::text[])
            and control_plane_outbox.effect_type = 'github.check_run.create'
          order by release_runs.status, release_runs.id`,
        [runIds],
      ),
    );

    expect(state).toHaveLength(2);
    expect(state.filter((row) => row.status === "queued")).toHaveLength(1);
    expect(state.filter((row) => row.status === "superseded")).toHaveLength(1);
    expect(state.filter((row) => row.status === "queued")[0]).toMatchObject({
      version: 0,
      active_attempts: 0,
      run_events: 0,
    });
    expect(state.filter((row) => row.status === "superseded")[0]).toMatchObject({
      version: 1,
      active_attempts: 0,
      run_events: 1,
    });
    for (const row of state) {
      expect(row.payload_run_id).toBe(row.id);
      expect(row.outbox_key).toBe(`github.check_run.create:${String(row.id)}`);
    }
  });

  it("atomically advances Check Run creation and workflow dispatch state", async () => {
    const plannedAt = new Date("2026-07-22T03:00:00.000Z");
    const runId = `run-transition-${suffix}`;
    const createOutboxId = `outbox-create-${suffix}`;
    const executionAttemptId = "11111111-1111-4111-8111-111111111111";
    const dispatchOutboxId = `outbox-dispatch-${suffix}`;
    const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([runId, createOutboxId]),
      now: () => plannedAt,
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    await lifecycle.enqueueReleaseRunWithOutbox(action("d".repeat(40)));
    const outbox = createSqlControlPlaneOutboxStore(database(), {
      now: () => plannedAt,
      leaseSeconds: 60,
    });

    const createEffects = await outbox.claimEffects({ workerId: `create-worker-${suffix}` });
    const createEffect = createEffects[0];
    if (!createEffect) throw new Error("expected Check Run creation effect");
    await expect(
      outbox.completeCheckRunCreateEffect({
        effect: createEffect,
        workerId: `create-worker-${suffix}`,
        githubCheckRunId: 987654,
        dispatchMode: "github-actions",
        executionAttemptId,
        nextOutboxId: dispatchOutboxId,
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      nextEffectType: "github.workflow.dispatch",
      nextOutboxId: dispatchOutboxId,
      executionAttemptId,
    });

    const prepared = rows(
      await database().query(
        `select release_runs.status as run_status,
                release_runs.version::int as run_version,
                release_runs.github_check_run_id,
                release_runs.execution_attempt_id,
                release_run_attempts.status as attempt_status,
                release_run_attempts.version::int as attempt_version,
                control_plane_outbox.status as dispatch_status,
                control_plane_outbox.expected_run_version::int as expected_run_version,
                control_plane_outbox.expected_attempt_version::int as expected_attempt_version
           from release_runs
           join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
           join control_plane_outbox on control_plane_outbox.execution_attempt_id = release_run_attempts.id
          where release_runs.id = $1
            and control_plane_outbox.effect_type = 'github.workflow.dispatch'`,
        [runId],
      ),
    )[0];
    expect(prepared).toEqual({
      run_status: "queued",
      run_version: 1,
      github_check_run_id: "987654",
      execution_attempt_id: executionAttemptId,
      attempt_status: "dispatching",
      attempt_version: 0,
      dispatch_status: "available",
      expected_run_version: 1,
      expected_attempt_version: 0,
    });

    const dispatchAt = new Date(plannedAt.valueOf() + 1000);
    const dispatchStore = createSqlControlPlaneOutboxStore(database(), {
      now: () => dispatchAt,
      leaseSeconds: 60,
    });
    const dispatchEffects = await dispatchStore.claimEffects({ workerId: `dispatch-worker-${suffix}` });
    const dispatchEffect = dispatchEffects.find((effect) => effect.outboxId === dispatchOutboxId);
    if (!dispatchEffect) throw new Error("expected workflow dispatch effect");
    await expect(
      dispatchStore.completeWorkflowDispatchEffect({
        effect: dispatchEffect,
        workerId: `dispatch-worker-${suffix}`,
        workflowDispatchId: "456789",
        workflowRunUrl: "https://github.test/octo/repo/actions/runs/456789",
      }),
    ).resolves.toBe("completed");

    const completed = rows(
      await database().query(
        `select release_runs.status as run_status,
                release_runs.version::int as run_version,
                release_run_attempts.status as attempt_status,
                release_run_attempts.version::int as attempt_version,
                release_run_attempts.github_workflow_dispatch_id,
                control_plane_outbox.status as outbox_status,
                control_plane_outbox.external_result ->> 'workflowDispatchId' as persisted_dispatch_id,
                (select count(*)::int from release_run_transition_events where release_run_id = release_runs.id)
                  as transition_events
           from release_runs
           join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
           join control_plane_outbox on control_plane_outbox.execution_attempt_id = release_run_attempts.id
          where release_runs.id = $1
            and control_plane_outbox.id = $2`,
        [runId, dispatchOutboxId],
      ),
    )[0];
    expect(completed).toEqual({
      run_status: "dispatched",
      run_version: 2,
      attempt_status: "dispatched",
      attempt_version: 1,
      github_workflow_dispatch_id: "456789",
      outbox_status: "completed",
      persisted_dispatch_id: "456789",
      transition_events: 3,
    });
  });

  it("terminalizes safe-mode Check Run creation through a versioned transition event", async () => {
    const prepared = await prepareCheckRunCreate("safe-mode", {
      ...action("2".repeat(40)),
      pullRequestDraft: true,
    });
    const completionOutboxId = `outbox-safe-mode-complete-${suffix}`;

    await expect(
      prepared.store.completeCheckRunCreateEffect({
        effect: prepared.effect,
        workerId: prepared.workerId,
        githubCheckRunId: 700001,
        dispatchMode: "github-actions",
        nextOutboxId: completionOutboxId,
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      nextEffectType: "github.check_run.complete",
      nextOutboxId: completionOutboxId,
    });

    expect(
      rows(
        await database().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_runs.decision,
                  release_runs.github_check_run_id,
                  release_runs.duration_ms,
                  (select count(*)::int from release_run_attempts where run_id = release_runs.id) as attempts,
                  (select status from control_plane_outbox where id = $2) as create_status,
                  (select status from control_plane_outbox where id = $3) as completion_status,
                  (select expected_run_version::int from control_plane_outbox where id = $3)
                    as completion_expected_run_version,
                  (select expected_attempt_version::int from control_plane_outbox where id = $3)
                    as completion_expected_attempt_version,
                  (select count(*)::int
                     from release_run_transition_events
                    where release_run_id = release_runs.id
                      and reason_code = 'check_run_safe_mode_completed') as transition_events
             from release_runs
            where release_runs.id = $1`,
          [prepared.runId, prepared.createOutboxId, completionOutboxId],
        ),
      )[0],
    ).toEqual({
      run_status: "completed",
      run_version: 1,
      decision: "neutral",
      github_check_run_id: "700001",
      duration_ms: 0,
      attempts: 0,
      create_status: "completed",
      completion_status: "available",
      completion_expected_run_version: null,
      completion_expected_attempt_version: null,
      transition_events: 1,
    });
  });

  it("keeps runner-disabled Check Run creation queued without changing the run version", async () => {
    const prepared = await prepareCheckRunCreate("runner-disabled", action("3".repeat(40)));

    await expect(
      prepared.store.completeCheckRunCreateEffect({
        effect: prepared.effect,
        workerId: prepared.workerId,
        githubCheckRunId: 700002,
        dispatchMode: "none",
      }),
    ).resolves.toEqual({ outcome: "completed" });

    expect(
      rows(
        await database().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_runs.github_check_run_id,
                  release_runs.execution_attempt_id,
                  control_plane_outbox.status as outbox_status,
                  (select count(*)::int from release_run_transition_events where release_run_id = release_runs.id)
                    as transition_events
             from release_runs
             join control_plane_outbox on control_plane_outbox.id = $2
            where release_runs.id = $1`,
          [prepared.runId, prepared.createOutboxId],
        ),
      )[0],
    ).toEqual({
      run_status: "queued",
      run_version: 0,
      github_check_run_id: "700002",
      execution_attempt_id: null,
      outbox_status: "completed",
      transition_events: 0,
    });
  });

  it("preserves the original Check Run binding and rejects run-version drift without writes", async () => {
    const prepared = await prepareCheckRunCreate("create-version-stale", action("4".repeat(40)));
    await database().query("update release_runs set version = version + 1 where id = $1", [prepared.runId]);
    await database().query(
      `insert into control_plane_outbox (
         id, release_run_id, effect_type, payload_version, idempotency_key,
         payload, priority, status, available_at, attempt_count, max_attempts, created_at
       )
       select $2, release_run_id, effect_type, payload_version, idempotency_key,
              payload, priority, 'available', available_at, 0, max_attempts, created_at
         from control_plane_outbox
        where id = $1
       on conflict (idempotency_key)
       do update set idempotency_key = excluded.idempotency_key`,
      [prepared.createOutboxId, `outbox-create-version-replay-${suffix}`],
    );

    expect(
      rows(
        await database().query(
          "select expected_run_version::int, expected_attempt_version::int from control_plane_outbox where id = $1",
          [prepared.createOutboxId],
        ),
      ),
    ).toEqual([{ expected_run_version: 0, expected_attempt_version: null }]);

    await expect(
      prepared.store.completeCheckRunCreateEffect({
        effect: prepared.effect,
        workerId: prepared.workerId,
        githubCheckRunId: 700003,
        dispatchMode: "github-actions",
        executionAttemptId: "33333333-3333-4333-8333-333333333333",
        nextOutboxId: `outbox-create-version-dispatch-${suffix}`,
      }),
    ).resolves.toEqual({ outcome: "stale" });

    expect(
      rows(
        await database().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_runs.github_check_run_id,
                  release_runs.execution_attempt_id,
                  control_plane_outbox.status as outbox_status,
                  (select count(*)::int from release_run_attempts where run_id = release_runs.id) as attempts,
                  (select count(*)::int from release_run_transition_events where release_run_id = release_runs.id)
                    as transition_events
             from release_runs
             join control_plane_outbox on control_plane_outbox.id = $2
            where release_runs.id = $1`,
          [prepared.runId, prepared.createOutboxId],
        ),
      )[0],
    ).toEqual({
      run_status: "queued",
      run_version: 1,
      github_check_run_id: null,
      execution_attempt_id: null,
      outbox_status: "leased",
      attempts: 0,
      transition_events: 0,
    });
  });

  it("rejects current-attempt pointer drift before creating another attempt", async () => {
    const prepared = await prepareCheckRunCreate("create-pointer-stale", action("5".repeat(40)));
    const driftAttemptId = "44444444-4444-4444-8444-444444444444";
    await database().query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at
       ) values ($1, $2, 1, 'dispatching', $3::timestamptz, $3::timestamptz)`,
      [driftAttemptId, prepared.runId, prepared.plannedAt.toISOString()],
    );
    await database().query(
      `update release_runs
          set execution_attempt_id = $2,
              execution_attempt_started_at = $3::timestamptz
        where id = $1`,
      [prepared.runId, driftAttemptId, prepared.plannedAt.toISOString()],
    );

    await expect(
      prepared.store.completeCheckRunCreateEffect({
        effect: prepared.effect,
        workerId: prepared.workerId,
        githubCheckRunId: 700004,
        dispatchMode: "github-actions",
        executionAttemptId: "55555555-5555-4555-8555-555555555555",
        nextOutboxId: `outbox-create-pointer-dispatch-${suffix}`,
      }),
    ).resolves.toEqual({ outcome: "stale" });

    expect(
      rows(
        await database().query(
          `select release_runs.version::int as run_version,
                  release_runs.github_check_run_id,
                  release_runs.execution_attempt_id,
                  control_plane_outbox.status as outbox_status,
                  (select count(*)::int from release_run_attempts where run_id = release_runs.id) as attempts,
                  (select count(*)::int from release_run_transition_events where release_run_id = release_runs.id)
                    as transition_events
             from release_runs
             join control_plane_outbox on control_plane_outbox.id = $2
            where release_runs.id = $1`,
          [prepared.runId, prepared.createOutboxId],
        ),
      )[0],
    ).toEqual({
      run_version: 0,
      github_check_run_id: null,
      execution_attempt_id: driftAttemptId,
      outbox_status: "leased",
      attempts: 1,
      transition_events: 0,
    });
  });

  it("quarantines a conflicting persisted Check Run ID without planning another effect", async () => {
    const prepared = await prepareCheckRunCreate("create-conflict", action("6".repeat(40)));
    await database().query("update release_runs set github_check_run_id = 700005 where id = $1", [prepared.runId]);

    await expect(
      prepared.store.completeCheckRunCreateEffect({
        effect: prepared.effect,
        workerId: prepared.workerId,
        githubCheckRunId: 700006,
        dispatchMode: "none",
      }),
    ).resolves.toEqual({ outcome: "check_run_conflict" });

    expect(
      rows(
        await database().query(
          `select release_runs.github_check_run_id,
                  release_runs.version::int as run_version,
                  control_plane_outbox.status as outbox_status,
                  control_plane_outbox.last_error_class,
                  control_plane_outbox.external_result ->> 'ensuredGitHubCheckRunId' as ensured_check_run_id,
                  (select count(*)::int from control_plane_outbox where release_run_id = release_runs.id)
                    as outbox_count
             from release_runs
             join control_plane_outbox on control_plane_outbox.id = $2
            where release_runs.id = $1`,
          [prepared.runId, prepared.createOutboxId],
        ),
      )[0],
    ).toEqual({
      github_check_run_id: "700005",
      run_version: 0,
      outbox_status: "reconciliation_required",
      last_error_class: "check_run_conflict",
      ensured_check_run_id: "700006",
      outbox_count: 1,
    });
  });

  it("rejects workflow completion when the effect-bound run version becomes stale", async () => {
    const prepared = await prepareWorkflowDispatch("run-version-stale", "f".repeat(40), 1);
    await prepared.dispatchStore.markDeliveryStarted({
      outboxId: prepared.dispatchOutboxId,
      workerId: prepared.dispatchWorkerId,
    });
    await database().query("update release_runs set version = version + 1 where id = $1", [prepared.runId]);
    await database().query(
      `insert into control_plane_outbox (
         id, release_run_id, execution_attempt_id, effect_type, payload_version,
         idempotency_key, payload, priority, status, available_at, attempt_count,
         max_attempts, created_at
       )
       select $2, release_run_id, execution_attempt_id, effect_type, payload_version,
              idempotency_key, payload, priority, 'available', available_at, 0,
              max_attempts, created_at
         from control_plane_outbox
        where id = $1
       on conflict (idempotency_key)
       do update set idempotency_key = excluded.idempotency_key`,
      [prepared.dispatchOutboxId, `outbox-run-version-replay-${suffix}`],
    );
    expect(
      rows(
        await database().query(
          `select expected_run_version::int, expected_attempt_version::int
             from control_plane_outbox
            where id = $1`,
          [prepared.dispatchOutboxId],
        ),
      ),
    ).toEqual([{ expected_run_version: 1, expected_attempt_version: 0 }]);

    await expect(
      prepared.dispatchStore.completeWorkflowDispatchEffect({
        effect: prepared.dispatchEffect,
        workerId: prepared.dispatchWorkerId,
        workflowDispatchId: "run-version-delivered",
      }),
    ).resolves.toBe("stale");

    expect(
      rows(
        await database().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  release_run_attempts.github_workflow_dispatch_id,
                  control_plane_outbox.status as outbox_status,
                  (select count(*)::int from release_run_transition_events where release_run_id = release_runs.id)
                    as transition_events
             from release_runs
             join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
             join control_plane_outbox on control_plane_outbox.id = $2
            where release_runs.id = $1`,
          [prepared.runId, prepared.dispatchOutboxId],
        ),
      )[0],
    ).toEqual({
      run_status: "queued",
      run_version: 2,
      attempt_status: "dispatching",
      attempt_version: 0,
      github_workflow_dispatch_id: null,
      outbox_status: "leased",
      transition_events: 1,
    });

    const recoveryAt = new Date(prepared.dispatchAt.valueOf() + 2000);
    await expect(
      createSqlControlPlaneOutboxStore(database(), { now: () => recoveryAt }).claimEffects({
        workerId: `run-version-recovery-${suffix}`,
      }),
    ).resolves.toEqual([]);
    expect(
      rows(
        await database().query("select status, last_error_class from control_plane_outbox where id = $1", [
          prepared.dispatchOutboxId,
        ]),
      )[0],
    ).toEqual({ status: "reconciliation_required", last_error_class: "delivery_uncertain" });
  });

  it("rejects workflow completion when the effect-bound attempt version becomes stale", async () => {
    const prepared = await prepareWorkflowDispatch("attempt-version-stale", "1".repeat(40));
    await database().query("update release_run_attempts set version = version + 1 where id = $1", [
      prepared.executionAttemptId,
    ]);

    await expect(
      prepared.dispatchStore.completeWorkflowDispatchEffect({
        effect: prepared.dispatchEffect,
        workerId: prepared.dispatchWorkerId,
        workflowDispatchId: "attempt-version-delivered",
      }),
    ).resolves.toBe("stale");

    expect(
      rows(
        await database().query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  release_run_attempts.github_workflow_dispatch_id,
                  control_plane_outbox.status as outbox_status,
                  (select count(*)::int from release_run_transition_events where release_run_id = release_runs.id)
                    as transition_events
             from release_runs
             join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
             join control_plane_outbox on control_plane_outbox.id = $2
            where release_runs.id = $1`,
          [prepared.runId, prepared.dispatchOutboxId],
        ),
      )[0],
    ).toEqual({
      run_status: "queued",
      run_version: 1,
      attempt_status: "dispatching",
      attempt_version: 1,
      github_workflow_dispatch_id: null,
      outbox_status: "leased",
      transition_events: 1,
    });
  });

  it("quarantines delivered workflow work when the authoritative transition becomes stale", async () => {
    const plannedAt = new Date("2026-07-22T04:00:00.000Z");
    const runId = `run-stale-${suffix}`;
    const createOutboxId = `outbox-stale-create-${suffix}`;
    const executionAttemptId = "22222222-2222-4222-8222-222222222222";
    const dispatchOutboxId = `outbox-stale-dispatch-${suffix}`;
    const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(database(), {
      id: idSequence([runId, createOutboxId]),
      now: () => plannedAt,
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    await lifecycle.enqueueReleaseRunWithOutbox(action("e".repeat(40)));
    const createStore = createSqlControlPlaneOutboxStore(database(), {
      now: () => plannedAt,
      leaseSeconds: 1,
    });
    const createEffect = (await createStore.claimEffects({ workerId: `stale-create-worker-${suffix}` }))[0];
    if (!createEffect) throw new Error("expected stale-path Check Run creation effect");
    await createStore.completeCheckRunCreateEffect({
      effect: createEffect,
      workerId: `stale-create-worker-${suffix}`,
      githubCheckRunId: 123456,
      dispatchMode: "github-actions",
      executionAttemptId,
      nextOutboxId: dispatchOutboxId,
    });

    const dispatchAt = new Date(plannedAt.valueOf() + 1000);
    const dispatchStore = createSqlControlPlaneOutboxStore(database(), {
      now: () => dispatchAt,
      leaseSeconds: 1,
    });
    const dispatchEffect = (await dispatchStore.claimEffects({ workerId: `stale-dispatch-worker-${suffix}` })).find(
      (effect) => effect.outboxId === dispatchOutboxId,
    );
    if (!dispatchEffect) throw new Error("expected stale-path workflow dispatch effect");
    await dispatchStore.markDeliveryStarted({
      outboxId: dispatchOutboxId,
      workerId: `stale-dispatch-worker-${suffix}`,
    });
    await database().query("update release_runs set status = 'completed', completed_at = $2 where id = $1", [
      runId,
      dispatchAt.toISOString(),
    ]);

    await expect(
      dispatchStore.completeWorkflowDispatchEffect({
        effect: dispatchEffect,
        workerId: `stale-dispatch-worker-${suffix}`,
        workflowDispatchId: "uncertain-456789",
      }),
    ).resolves.toBe("stale");

    const recoveryAt = new Date(dispatchAt.valueOf() + 2000);
    await expect(
      createSqlControlPlaneOutboxStore(database(), { now: () => recoveryAt }).claimEffects({
        workerId: `stale-recovery-worker-${suffix}`,
      }),
    ).resolves.toEqual([]);
    const quarantined = rows(
      await database().query("select status, last_error_class from control_plane_outbox where id = $1", [
        dispatchOutboxId,
      ]),
    )[0];
    expect(quarantined).toEqual({
      status: "reconciliation_required",
      last_error_class: "delivery_uncertain",
    });
  });
});
