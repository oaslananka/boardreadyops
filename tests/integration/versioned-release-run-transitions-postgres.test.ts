import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createControlPlaneRunTransitionStore } from "../../packages/db/src/control-plane-run-transition-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const testPrefix = `versioned-transition-${randomUUID()}`;
let externalId = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 11), 16);

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

async function seedRun(input?: {
  runStatus?: string;
  attemptStatus?: string;
  runVersion?: number;
  attemptVersion?: number;
}) {
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const releaseRunId = randomUUID();
  const executionAttemptId = randomUUID();
  const startedAt = new Date("2026-07-27T04:55:00.000Z");
  const runStatus = input?.runStatus ?? "dispatched";
  const attemptStatus = input?.attemptStatus ?? "dispatched";
  const runCompletedAt = ["completed", "failed", "timed_out", "cancelled", "superseded"].includes(runStatus)
    ? startedAt.toISOString()
    : null;
  const attemptCompletedAt = ["completed", "failed", "cancelled", "timed_out", "stale", "superseded"].includes(
    attemptStatus,
  )
    ? startedAt.toISOString()
    : null;
  externalId += 2;

  await database().query(
    `insert into installations (
       id, github_installation_id, account_login, account_type, plan_tier
     ) values ($1, $2::bigint, $3, 'Organization', 'enterprise')`,
    [installationId, externalId, `${testPrefix}-${installationId}`],
  );
  await database().query(
    `insert into repositories (
       id, installation_id, github_repo_id, owner, name, private, default_branch
     ) values ($1, $2, $3::bigint, 'octo-org', $4, true, 'main')`,
    [repositoryId, installationId, externalId + 1, `board-${repositoryId}`],
  );
  await database().query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind,
       status, started_at, completed_at, execution_attempt_id, execution_attempt_started_at, version
     ) values (
       $1, $2, $3, $4, 'refs/heads/main', 'push',
       $5, $6::timestamptz, $7::timestamptz, $8, $6::timestamptz, $9::bigint
     )`,
    [
      releaseRunId,
      repositoryId,
      `${testPrefix}:${releaseRunId}`,
      "a".repeat(40),
      runStatus,
      startedAt.toISOString(),
      runCompletedAt,
      executionAttemptId,
      input?.runVersion ?? 4,
    ],
  );
  await database().query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at,
       dispatch_requested_at, dispatched_at, started_at, completed_at, version
     ) values (
       $1, $2, 1, $3, $4::timestamptz,
       $4::timestamptz, $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::bigint
     )`,
    [
      executionAttemptId,
      releaseRunId,
      attemptStatus,
      startedAt.toISOString(),
      attemptCompletedAt,
      input?.attemptVersion ?? 2,
    ],
  );

  return { installationId, repositoryId, releaseRunId, executionAttemptId };
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("versioned release-run PostgreSQL transitions", () => {
  it("atomically transitions the run and current attempt with tenant-scoped append-only events", async () => {
    const ids = await seedRun();
    const store = createControlPlaneRunTransitionStore(database());
    const startedAt = new Date("2026-07-27T05:00:00.000Z");

    await expect(
      store.transition({
        releaseRunId: ids.releaseRunId,
        expectedRunStatus: "dispatched",
        expectedRunVersion: 4,
        expectedExecutionAttemptId: ids.executionAttemptId,
        expectedAttemptStatus: "dispatched",
        expectedAttemptVersion: 2,
        nextRunStatus: "running",
        nextAttemptStatus: "in_progress",
        reasonCode: "workflow_started",
        transitionedAt: startedAt,
      }),
    ).resolves.toEqual({
      outcome: "applied",
      runStatus: "running",
      runVersion: 5,
      attemptStatus: "in_progress",
      attemptVersion: 3,
    });

    const firstEvents = rows(
      await database().query(
        `select entity_type, installation_id, repository_id, release_run_id, execution_attempt_id,
                from_status, to_status, from_version::int, to_version::int, reason_code, occurred_at
           from release_run_transition_events
          where release_run_id = $1
          order by entity_type`,
        [ids.releaseRunId],
      ),
    );
    expect(firstEvents).toEqual([
      {
        entity_type: "execution_attempt",
        installation_id: ids.installationId,
        repository_id: ids.repositoryId,
        release_run_id: ids.releaseRunId,
        execution_attempt_id: ids.executionAttemptId,
        from_status: "dispatched",
        to_status: "in_progress",
        from_version: 2,
        to_version: 3,
        reason_code: "workflow_started",
        occurred_at: startedAt,
      },
      {
        entity_type: "release_run",
        installation_id: ids.installationId,
        repository_id: ids.repositoryId,
        release_run_id: ids.releaseRunId,
        execution_attempt_id: null,
        from_status: "dispatched",
        to_status: "running",
        from_version: 4,
        to_version: 5,
        reason_code: "workflow_started",
        occurred_at: startedAt,
      },
    ]);

    const completedAt = new Date("2026-07-27T05:05:00.000Z");
    await expect(
      store.transition({
        releaseRunId: ids.releaseRunId,
        expectedRunStatus: "running",
        expectedRunVersion: 5,
        expectedExecutionAttemptId: ids.executionAttemptId,
        expectedAttemptStatus: "in_progress",
        expectedAttemptVersion: 3,
        nextRunStatus: "completed",
        nextAttemptStatus: "completed",
        reasonCode: "runner_result_received",
        transitionedAt: completedAt,
      }),
    ).resolves.toEqual({
      outcome: "applied",
      runStatus: "completed",
      runVersion: 6,
      attemptStatus: "completed",
      attemptVersion: 4,
    });

    expect(
      rows(
        await database().query(
          `select rr.status as run_status, rr.version::int as run_version, rr.completed_at as run_completed_at,
                  rra.status as attempt_status, rra.version::int as attempt_version,
                  rra.completed_at as attempt_completed_at,
                  (select count(*)::int from release_run_transition_events where release_run_id = rr.id) as events
             from release_runs rr
             join release_run_attempts rra on rra.id = rr.execution_attempt_id
            where rr.id = $1`,
          [ids.releaseRunId],
        ),
      )[0],
    ).toEqual({
      run_status: "completed",
      run_version: 6,
      run_completed_at: completedAt,
      attempt_status: "completed",
      attempt_version: 4,
      attempt_completed_at: completedAt,
      events: 4,
    });

    const eventId = String(
      firstEvents[0]?.id ??
        rows(
          await database().query(
            "select id from release_run_transition_events where release_run_id = $1 order by id limit 1",
            [ids.releaseRunId],
          ),
        )[0]?.id,
    );
    await expect(
      database().query("update release_run_transition_events set reason_code = 'changed' where id = $1", [eventId]),
    ).rejects.toThrow("release_run_transition_events is append-only");
    await expect(
      database().query("delete from release_run_transition_events where id = $1", [eventId]),
    ).rejects.toThrow("release_run_transition_events is append-only");
  });

  it("fails closed for stale run versions, stale attempt versions, and wrong current attempts", async () => {
    const ids = await seedRun();
    const store = createControlPlaneRunTransitionStore(database());
    const base = {
      releaseRunId: ids.releaseRunId,
      expectedRunStatus: "dispatched" as const,
      expectedRunVersion: 4,
      expectedExecutionAttemptId: ids.executionAttemptId,
      expectedAttemptStatus: "dispatched" as const,
      expectedAttemptVersion: 2,
      nextRunStatus: "running" as const,
      nextAttemptStatus: "in_progress" as const,
      reasonCode: "workflow_started",
      transitionedAt: new Date("2026-07-27T05:00:00.000Z"),
    };

    await expect(store.transition({ ...base, expectedRunVersion: 3 })).resolves.toMatchObject({
      outcome: "stale",
      runStatus: "dispatched",
      runVersion: 4,
    });
    await expect(store.transition({ ...base, expectedAttemptVersion: 1 })).resolves.toEqual({
      outcome: "stale",
      runStatus: "dispatched",
      runVersion: 4,
      attemptStatus: "dispatched",
      attemptVersion: 2,
    });
    await expect(store.transition({ ...base, expectedExecutionAttemptId: randomUUID() })).resolves.toMatchObject({
      outcome: "stale",
      runStatus: "dispatched",
      runVersion: 4,
    });

    expect(
      rows(
        await database().query(
          `select rr.status as run_status, rr.version::int as run_version,
                  rra.status as attempt_status, rra.version::int as attempt_version,
                  (select count(*)::int from release_run_transition_events where release_run_id = rr.id) as events
             from release_runs rr
             join release_run_attempts rra on rra.id = rr.execution_attempt_id
            where rr.id = $1`,
          [ids.releaseRunId],
        ),
      )[0],
    ).toEqual({
      run_status: "dispatched",
      run_version: 4,
      attempt_status: "dispatched",
      attempt_version: 2,
      events: 0,
    });
  });

  it("rejects invalid and terminal outgoing edges without changing authoritative state", async () => {
    const active = await seedRun({
      runStatus: "running",
      attemptStatus: "in_progress",
      runVersion: 1,
      attemptVersion: 1,
    });
    const store = createControlPlaneRunTransitionStore(database());

    await expect(
      store.transition({
        releaseRunId: active.releaseRunId,
        expectedRunStatus: "running",
        expectedRunVersion: 1,
        expectedExecutionAttemptId: active.executionAttemptId,
        nextRunStatus: "queued",
        reasonCode: "invalid_rewind",
        transitionedAt: new Date("2026-07-27T05:00:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "invalid_transition",
      runStatus: "running",
      runVersion: 1,
      attemptStatus: "in_progress",
      attemptVersion: 1,
    });

    const terminal = await seedRun({
      runStatus: "completed",
      attemptStatus: "completed",
      runVersion: 6,
      attemptVersion: 4,
    });
    await expect(
      store.transition({
        releaseRunId: terminal.releaseRunId,
        expectedRunStatus: "completed",
        expectedRunVersion: 6,
        expectedExecutionAttemptId: terminal.executionAttemptId,
        nextRunStatus: "failed",
        reasonCode: "late_failure",
        transitionedAt: new Date("2026-07-27T05:10:00.000Z"),
      }),
    ).resolves.toMatchObject({ outcome: "invalid_transition", runStatus: "completed", runVersion: 6 });

    expect(
      rows(
        await database().query(
          `select count(*)::int as events
             from release_run_transition_events
            where release_run_id in ($1, $2)`,
          [active.releaseRunId, terminal.releaseRunId],
        ),
      ),
    ).toEqual([{ events: 0 }]);
  });
});
