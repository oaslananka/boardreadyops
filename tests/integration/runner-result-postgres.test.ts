import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../apps/web/app/api/v1/runs/result/route.js";
import { createSqlGitHubAppLifecycleStore } from "../../packages/db/src/lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 1 }) : undefined;
const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const completedAt = "2026-07-12T12:00:00.000Z";

type QueryRow = Record<string, unknown>;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

const dependencies: ResultRouteDependencies = {
  queryExecutor: () => executor,
  checkRunClient: () => undefined,
  detailsUrl: (id) => `https://boardreadyops.test/runs/${id}`,
  now: () => new Date(completedAt),
  verifyOidcToken: async (_token, expectedRunId, expectedAttemptId) =>
    expectedRunId === runId && expectedAttemptId === attemptId,
};

function callbackRequest(overrides: Record<string, unknown> = {}): Request {
  const url = new URL("https://boardreadyops.test/api/v1/runs/result");
  url.searchParams.set("run_id", runId);
  url.searchParams.set("attempt_id", attemptId);
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer header.payload.signature", "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      executionAttemptId: attemptId,
      status: "completed",
      conclusion: "failure",
      decision: "fail",
      findings: [
        {
          ruleId: "bom.missing-mpn",
          severity: "high",
          message: "A production part is missing its MPN.",
          path: "board.kicad_sch",
        },
      ],
      artifacts: [
        {
          kind: "html-report",
          name: "boardreadyops-report.html",
          storagePath: "runs/33333333-3333-4333-8333-333333333333/report.html",
          sha256: "a".repeat(64),
          bytes: 2048,
          role: "report",
        },
      ],
      metrics: { durationMs: 1250, readinessScore: 82 },
      reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-123/index.html" }],
      ...overrides,
    }),
  });
}

beforeAll(async () => {
  if (!executor) return;
  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 12345, 'octo-org', 'Organization')`,
    [installationId],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 67890, 'octo-org', 'hardware-board', 'main')`,
    [repositoryId, installationId],
  );
  await executor.query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, trigger_kind, status,
       execution_attempt_id, execution_attempt_started_at, started_at
     ) values ($1, $2, $3, 'refs/pull/42/head', 'pr', 'running', $4, $5::timestamptz, $5::timestamptz)`,
    [runId, repositoryId, "0123456789abcdef0123456789abcdef01234567", attemptId, "2026-07-12T11:59:58.750Z"],
  );
  await executor.query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at, started_at
     ) values ($1, $2, 1, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
    [attemptId, runId, "2026-07-12T11:59:58.750Z"],
  );
});

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [installationId]);
});

describeDatabase("runner result PostgreSQL integration", () => {
  it("persists the versioned result atomically and accepts exact replay", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const accepted = await handleResultRequest(callbackRequest(), dependencies);
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ ok: true, status: "accepted", runId });

    const replayed = await handleResultRequest(callbackRequest(), dependencies);
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({ ok: true, status: "replayed", runId });

    const conflicting = await handleResultRequest(
      callbackRequest({ status: "failed", decision: "error", findings: [] }),
      dependencies,
    );
    expect(conflicting.status).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({
      ok: false,
      error: "terminal result conflicts with the persisted result",
      runId,
      executionAttemptId: attemptId,
    });

    const runRows = rows(
      await executor.query(
        `select status, version::int as version, decision, completed_at, duration_ms, terminal_result_digest
       from release_runs where id = $1`,
        [runId],
      ),
    );
    expect(runRows).toEqual([
      expect.objectContaining({
        status: "completed",
        version: 1,
        decision: "fail",
        completed_at: new Date(completedAt),
        duration_ms: 1250,
        terminal_result_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);

    const attemptRows = rows(
      await executor.query(
        `select status, version::int as version, completed_at, result_digest
           from release_run_attempts
          where id = $1`,
        [attemptId],
      ),
    );
    expect(attemptRows).toEqual([
      expect.objectContaining({
        status: "completed",
        version: 1,
        completed_at: new Date(completedAt),
        result_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);

    const transitionRows = rows(
      await executor.query(
        `select entity_type, from_status, to_status, from_version::int, to_version::int, reason_code
           from release_run_transition_events
          where release_run_id = $1
          order by entity_type`,
        [runId],
      ),
    );
    expect(transitionRows).toEqual([
      {
        entity_type: "execution_attempt",
        from_status: "in_progress",
        to_status: "completed",
        from_version: 0,
        to_version: 1,
        reason_code: "runner_result_completed",
      },
      {
        entity_type: "release_run",
        from_status: "running",
        to_status: "completed",
        from_version: 0,
        to_version: 1,
        reason_code: "runner_result_completed",
      },
    ]);

    const resultRows = rows(
      await executor.query(
        `select contract_version, status, conclusion, decision, metrics, report_links,
              result_digest, last_publication_attempt_at, last_publication_error
       from release_run_results where run_id = $1`,
        [runId],
      ),
    );
    expect(resultRows).toEqual([
      expect.objectContaining({
        contract_version: 1,
        status: "completed",
        conclusion: "failure",
        decision: "fail",
        metrics: { durationMs: 1250, readinessScore: 82 },
        report_links: [{ label: "HTML report", url: "https://reports.example.test/run-123/index.html" }],
        result_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        last_publication_attempt_at: new Date(completedAt),
        last_publication_error: null,
      }),
    ]);

    const childRows = rows(
      await executor.query(
        `select
         (select count(*)::int from findings where run_id = $1) as findings,
         (select count(*)::int from artifacts where run_id = $1) as artifacts`,
        [runId],
      ),
    );
    expect(childRows).toEqual([{ findings: 1, artifacts: 1 }]);

    const auditRows = rows(
      await executor.query(`select event_type from audit_events where release_run_id = $1 order by created_at, id`, [
        runId,
      ]),
    );
    expect(auditRows.map((row) => row.event_type)).toEqual([
      "runner.result.persisted",
      "runner.result.publication_succeeded",
      "runner.result.publication_succeeded",
    ]);

    await expect(executor.query("delete from audit_events where release_run_id = $1", [runId])).rejects.toThrow(
      "audit_events is append-only",
    );
    await executor.query("delete from installations where id = $1", [installationId]);
    const remainingRows = rows(
      await executor.query(
        `select
           (select count(*)::int from installations where id = $1) as installations,
           (select count(*)::int from repositories where id = $2) as repositories,
           (select count(*)::int from release_runs where id = $3) as runs,
           (select count(*)::int from audit_events where release_run_id = $3) as audit_events`,
        [installationId, repositoryId, runId],
      ),
    );
    expect(remainingRows).toEqual([{ installations: 0, repositories: 0, runs: 0, audit_events: 0 }]);
  });
  it("fails closed on stale runner-result run and attempt versions without metadata or events", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const staleInstallationId = "99999999-9999-4999-8999-999999999991";
    const staleRepositoryId = "99999999-9999-4999-8999-999999999992";
    const staleRunId = "99999999-9999-4999-8999-999999999993";
    const staleAttemptId = "99999999-9999-4999-8999-999999999994";
    const digest = "b".repeat(64);

    await executor.query("delete from installations where id = $1", [staleInstallationId]);
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, 33333, 'stale-org', 'Organization')`,
      [staleInstallationId],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
       values ($1, $2, 33334, 'stale-org', 'stale-board', 'main')`,
      [staleRepositoryId, staleInstallationId],
    );
    await executor.query(
      `insert into release_runs (
         id, repository_id, commit_sha, ref, trigger_kind, status,
         execution_attempt_id, execution_attempt_started_at, started_at
       ) values ($1, $2, $3, 'refs/heads/main', 'manual', 'running', $4, $5::timestamptz, $5::timestamptz)`,
      [staleRunId, staleRepositoryId, "3".repeat(40), staleAttemptId, "2026-07-12T13:00:00.000Z"],
    );
    await executor.query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at, started_at
       ) values ($1, $2, 1, 'in_progress', $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
      [staleAttemptId, staleRunId, "2026-07-12T13:00:00.000Z"],
    );

    const staleRun = rows(
      await executor.query(
        `select * from boardreadyops_apply_runner_result_state(
           $1, true, 'running', 1, $2, 'in_progress', 0,
           'completed', 'pass', $3::timestamptz, $4, $4
         )`,
        [staleRunId, staleAttemptId, "2026-07-12T13:01:00.000Z", digest],
      ),
    );
    expect(staleRun[0]?.transition_outcome).toBe("stale");

    const staleAttempt = rows(
      await executor.query(
        `select * from boardreadyops_apply_runner_result_state(
           $1, true, 'running', 0, $2, 'in_progress', 1,
           'completed', 'pass', $3::timestamptz, $4, $4
         )`,
        [staleRunId, staleAttemptId, "2026-07-12T13:01:00.000Z", digest],
      ),
    );
    expect(staleAttempt[0]?.transition_outcome).toBe("stale");

    expect(
      rows(
        await executor.query(
          `select release_runs.status as run_status,
                  release_runs.version::int as run_version,
                  release_runs.decision,
                  release_run_attempts.status as attempt_status,
                  release_run_attempts.version::int as attempt_version,
                  release_run_attempts.result_digest,
                  (select count(*)::int from release_run_transition_events where release_run_id = $1) as events
             from release_runs
             join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
            where release_runs.id = $1`,
          [staleRunId],
        ),
      )[0],
    ).toEqual({
      run_status: "running",
      run_version: 0,
      decision: null,
      attempt_status: "in_progress",
      attempt_version: 0,
      result_digest: null,
      events: 0,
    });

    await executor.query("delete from installations where id = $1", [staleInstallationId]);
  });

  it("maps running and no-attempt callbacks while emitting events only for changed entities", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const progressInstallationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const progressRepositoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const progressRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    const progressAttemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
    const noAttemptRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
    const digest = "c".repeat(64);

    await executor.query("delete from installations where id = $1", [progressInstallationId]);
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, 44444, 'progress-org', 'Organization')`,
      [progressInstallationId],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
       values ($1, $2, 44445, 'progress-org', 'progress-board', 'main')`,
      [progressRepositoryId, progressInstallationId],
    );
    await executor.query(
      `insert into release_runs (
         id, repository_id, commit_sha, ref, trigger_kind, status,
         execution_attempt_id, execution_attempt_started_at, started_at
       ) values
         ($1, $3, $4, 'refs/heads/main', 'manual', 'dispatched', $2, $6::timestamptz, $6::timestamptz),
         ($5, $3, $7, 'refs/heads/main', 'manual', 'queued', null, null, $6::timestamptz)`,
      [
        progressRunId,
        progressAttemptId,
        progressRepositoryId,
        "4".repeat(40),
        noAttemptRunId,
        "2026-07-12T14:00:00.000Z",
        "5".repeat(40),
      ],
    );
    await executor.query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at
       ) values ($1, $2, 1, 'dispatching', $3::timestamptz, $3::timestamptz, $3::timestamptz)`,
      [progressAttemptId, progressRunId, "2026-07-12T14:00:00.000Z"],
    );

    const progress = rows(
      await executor.query(
        `select transition_outcome,
                run_status,
                run_version::int as run_version,
                attempt_status,
                attempt_version::int as attempt_version,
                run_changed,
                attempt_changed
           from boardreadyops_apply_runner_result_state(
             $1, true, 'dispatched', 0, $2, 'dispatching', 0,
             'running', null, $3::timestamptz, null, $4
           )`,
        [progressRunId, progressAttemptId, "2026-07-12T14:01:00.000Z", digest],
      ),
    );
    expect(progress[0]).toMatchObject({
      transition_outcome: "applied",
      run_status: "running",
      run_version: 1,
      attempt_status: "in_progress",
      attempt_version: 1,
      run_changed: true,
      attempt_changed: true,
    });

    const noAttempt = rows(
      await executor.query(
        `select transition_outcome,
                run_status,
                run_version::int as run_version,
                attempt_status,
                attempt_version::int as attempt_version,
                run_changed,
                attempt_changed
           from boardreadyops_apply_runner_result_state(
             $1, true, 'queued', 0, null, null, null,
             'running', null, $2::timestamptz, null, $3
           )`,
        [noAttemptRunId, "2026-07-12T14:01:00.000Z", digest],
      ),
    );
    expect(noAttempt[0]).toMatchObject({
      transition_outcome: "applied",
      run_status: "running",
      run_version: 1,
      attempt_status: null,
      attempt_version: null,
      run_changed: true,
      attempt_changed: false,
    });

    expect(
      rows(
        await executor.query(
          `select release_run_id, entity_type, from_status, to_status, reason_code
             from release_run_transition_events
            where release_run_id = any($1::text[])
            order by release_run_id, entity_type`,
          [[progressRunId, noAttemptRunId]],
        ),
      ),
    ).toEqual([
      {
        release_run_id: progressRunId,
        entity_type: "execution_attempt",
        from_status: "dispatching",
        to_status: "in_progress",
        reason_code: "runner_result_running",
      },
      {
        release_run_id: progressRunId,
        entity_type: "release_run",
        from_status: "dispatched",
        to_status: "running",
        reason_code: "runner_result_running",
      },
      {
        release_run_id: noAttemptRunId,
        entity_type: "release_run",
        from_status: "queued",
        to_status: "running",
        reason_code: "runner_result_running",
      },
    ]);

    await executor.query("delete from installations where id = $1", [progressInstallationId]);
  });

  it("records retry attempts separately and supersedes the active attempt with a newer commit", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const lifecycleInstallationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const lifecycleRepositoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, 54321, 'octo-org', 'Organization')`,
      [lifecycleInstallationId],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
       values ($1, $2, 98765, 'octo-org', 'hardware-board', 'main')`,
      [lifecycleRepositoryId, lifecycleInstallationId],
    );
    const firstRunId = "55555555-5555-4555-8555-555555555555";
    const secondRunId = "66666666-6666-4666-8666-666666666666";
    const logicalRunIds = [firstRunId, secondRunId];
    const attemptOne = "77777777-7777-4777-8777-777777777777";
    const attemptTwo = "88888888-8888-4888-8888-888888888888";
    const ids = [...logicalRunIds];
    const enqueueTimes = ["2026-07-12T12:10:00.000Z", "2026-07-12T12:10:04.000Z"];
    const store = createSqlGitHubAppLifecycleStore(executor, {
      id: () => ids.shift() ?? "99999999-9999-4999-8999-999999999999",
      now: () => new Date(enqueueTimes.shift() ?? "2026-07-12T12:10:04.000Z"),
      releaseRepositoryRolloutPolicy: { allowAllRepositories: true },
    });
    const action = {
      type: "release_run.enqueue" as const,
      installation: { id: 54321, accountLogin: "octo-org", accountType: "Organization" },
      repository: {
        id: 98765,
        owner: "octo-org",
        name: "hardware-board",
        fullName: "octo-org/hardware-board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 77,
      ref: "feature/attempt-history",
      commitSha: "1111111111111111111111111111111111111111",
      triggerKind: "pr" as const,
    };

    const first = await store.enqueueReleaseRun(action);
    expect(first.runId).toBe(firstRunId);
    await expect(
      store.bindReleaseRunExecutionAttempt({
        runId: firstRunId,
        executionAttemptId: attemptOne,
        startedAt: "2026-07-12T12:10:01.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      store.bindReleaseRunExecutionAttempt({
        runId: firstRunId,
        executionAttemptId: attemptTwo,
        startedAt: "2026-07-12T12:10:02.000Z",
      }),
    ).resolves.toBe(true);
    await store.markReleaseRunDispatched({
      runId: firstRunId,
      executionAttemptId: attemptTwo,
      dispatchedAt: "2026-07-12T12:10:03.000Z",
      workflowDispatchId: "dispatch-2",
    });

    const second = await store.enqueueReleaseRun({
      ...action,
      commitSha: "2222222222222222222222222222222222222222",
    });
    expect(second.runId).toBe(secondRunId);

    const attempts = (await executor.query(
      `select attempt_number, status, completed_at, github_workflow_dispatch_id, failure_class
       from release_run_attempts
       where run_id = $1
       order by attempt_number`,
      [firstRunId],
    )) as { rows: readonly Record<string, unknown>[] };
    expect(attempts.rows).toEqual([
      expect.objectContaining({
        attempt_number: 1,
        status: "failed",
        completed_at: new Date("2026-07-12T12:10:02.000Z"),
        github_workflow_dispatch_id: null,
        failure_class: "dispatch_replaced",
      }),
      expect.objectContaining({
        attempt_number: 2,
        status: "superseded",
        completed_at: new Date("2026-07-12T12:10:04.000Z"),
        github_workflow_dispatch_id: "dispatch-2",
        failure_class: "newer_commit",
      }),
    ]);
    const superseded = (await executor.query(`select status from release_runs where id = $1`, [firstRunId])) as {
      rows: readonly Record<string, unknown>[];
    };
    expect(superseded.rows).toEqual([{ status: "superseded" }]);
    await executor.query("delete from installations where id = $1", [lifecycleInstallationId]);
  });
});
