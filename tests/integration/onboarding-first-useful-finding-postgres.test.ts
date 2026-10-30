import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../apps/web/app/api/v1/runs/result/route.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const installationId = randomUUID();
const repositoryId = randomUUID();
const runId = randomUUID();
const attemptId = randomUUID();
const githubInstallationId = Number.parseInt(randomBytes(6).toString("hex"), 16);
const githubRepositoryId = githubInstallationId + 1;
const sha = "d".repeat(40);
const emitted: Array<Record<string, unknown>> = [];
let providerAvailable = false;
let completedCheckRuns = 0;

function database() {
  if (!executor) throw new Error("Disposable PostgreSQL connection not configured");
  return executor;
}

function request(): Request {
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
          message: "Private test fixture should not enter telemetry.",
        },
      ],
      artifacts: [],
      metrics: {},
      reportLinks: [],
    }),
  });
}

const dependencies: ResultRouteDependencies = {
  queryExecutor: () => executor,
  checkRunClient: () => ({
    createPullRequestCheckRun: async () => ({ id: 777 }),
    completeCheckRun: async () => {
      completedCheckRuns++;
      if (!providerAvailable) throw new Error("simulated unavailable GitHub Checks provider");
    },
    createPullRequestComment: async () => {},
  }),
  detailsUrl: () => "https://boardreadyops.test/runs/detail",
  now: () => new Date(),
  verifyOidcToken: async (_token, givenRunId, givenAttemptId) => givenRunId === runId && givenAttemptId === attemptId,
  emitTelemetry: (event) => {
    emitted.push(event);
  },
};

beforeAll(async () => {
  if (!executor) return;
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, 'ttfuf-fixture', 'Organization')`,
    [installationId, githubInstallationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, $3, 'ttfuf-fixture', 'board', 'main')`,
    [repositoryId, installationId, githubRepositoryId],
  );
  await database().query(
    `insert into audit_events (
       id, installation_id, event_type, actor_type, subject_type, subject_id, created_at
     ) values ($1, $2, 'github_app.installation.enabled', 'github_webhook', 'installation', $2,
               now() - interval '3 minutes')`,
    [randomUUID(), installationId],
  );
  await database().query(
    `insert into audit_events (
       id, installation_id, repository_id, event_type, actor_type,
       subject_type, subject_id, created_at
     ) values ($1, $2, $3, 'github_app.repository.enabled', 'github_webhook', 'repository',
               $3, now() - interval '2 minutes')`,
    [randomUUID(), installationId, repositoryId],
  );
  await database().query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind,
       status, github_check_run_id, execution_attempt_id,
       execution_attempt_started_at, started_at
     ) values ($1, $2, $3, 'refs/pull/5/head', 5, 'pr',
               'running', 777, $4, now() - interval '30 seconds', now() - interval '30 seconds')`,
    [runId, repositoryId, sha, attemptId],
  );
  await database().query(
    `insert into release_run_attempts (
       id, run_id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at, started_at
     ) values ($1, $2, 1, 'in_progress', now() - interval '30 seconds',
               now() - interval '30 seconds', now() - interval '30 seconds',
               now() - interval '30 seconds')`,
    [attemptId, runId],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = $1", [installationId]);
  await database().close();
});

describeDatabase("first useful finding after a real persisted Check Run", () => {
  it("does not activate on failed GitHub publication; records exactly once on recovered replay", async () => {
    const failed = await handleResultRequest(request(), dependencies);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ ok: false, persisted: true, checkRunUpdated: false });

    const before = await database().query(
      "select id from audit_events where repository_id = $1 and event_type = 'onboarding.first_useful_finding.published'",
      [repositoryId],
    );
    expect((before as { rows: unknown[] }).rows).toHaveLength(0);
    expect(emitted).toHaveLength(0);

    providerAvailable = true;
    const recovered = await handleResultRequest(request(), dependencies);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ ok: true, status: "replayed", checkRunUpdated: true });

    const recorded = await database().query(
      `select id, release_run_id, metadata from audit_events
        where repository_id = $1 and event_type = 'onboarding.first_useful_finding.published'`,
      [repositoryId],
    );
    const rows = (recorded as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.release_run_id).toBe(runId);
    expect(rows[0]?.metadata).toMatchObject({
      ruleCategory: "bom",
      severity: "high",
      timeToFindingSeconds: expect.any(Number),
    });
    expect(emitted).toEqual([
      {
        event: "first_useful_finding_produced",
        installationId: githubInstallationId,
        repositoryId: githubRepositoryId,
        ruleCategory: "bom",
        severity: "high",
        timeToFindingSeconds: expect.any(Number),
      },
    ]);
    expect(
      (rows[0]?.metadata as { timeToFindingSeconds: number } | undefined)?.timeToFindingSeconds,
    ).toBeGreaterThanOrEqual(115);
    expect(JSON.stringify(emitted)).not.toContain("Private test fixture");

    const replay = await handleResultRequest(request(), dependencies);
    expect(replay.status).toBe(200);
    expect(emitted).toHaveLength(1);
    const repeated = await database().query(
      "select count(*)::int as total from audit_events where repository_id = $1 and event_type = 'onboarding.first_useful_finding.published'",
      [repositoryId],
    );
    expect((repeated as { rows: Array<{ total: number }> }).rows[0]?.total).toBe(1);
    expect(completedCheckRuns).toBe(3);
  });
});
