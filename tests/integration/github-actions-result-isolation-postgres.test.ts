import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type GitHubActionsResultRouteDependencies,
  handleGitHubActionsResultRequest,
} from "../../apps/web/app/api/v1/runs/github-actions-result/route.js";
import { handleResultRequest, type ResultRouteDependencies } from "../../apps/web/app/api/v1/runs/result/route.js";
import {
  resetGitHubActionsOidcJwksCache,
  verifyGitHubActionsOidcToken,
} from "../../apps/web/lib/github-actions-oidc.js";
import { resultOidcExpectations } from "../../apps/web/lib/result-oidc-expectations.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const nowMs = Date.UTC(2026, 7, 2, 4, 30, 0);
const keyId = "two-installation-isolation-key";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: keyId,
  use: "sig",
};

const fixtures = {
  a: {
    installationId: "10000000-0000-4000-8000-000000000001",
    githubInstallationId: 9_100_001,
    repositoryId: "10000000-0000-4000-8000-000000000002",
    githubRepositoryId: "910000002",
    owner: "isolation-owner-a",
    name: "private-board-a",
    private: true,
    runId: "10000000-0000-4000-8000-000000000003",
    attemptId: "10000000-0000-4000-8000-000000000004",
    commitSha: "a".repeat(40),
    checkRunId: 9_100_003,
    pullRequestNumber: 17,
    trustMode: "safe" as const,
    safeModeReasons: ["private-repository"] as const,
  },
  b: {
    installationId: "20000000-0000-4000-8000-000000000001",
    githubInstallationId: 9_200_001,
    repositoryId: "20000000-0000-4000-8000-000000000002",
    githubRepositoryId: "920000002",
    owner: "isolation-owner-b",
    name: "public-board-b",
    private: false,
    runId: "20000000-0000-4000-8000-000000000003",
    attemptId: "20000000-0000-4000-8000-000000000004",
    commitSha: "b".repeat(40),
    checkRunId: 9_200_003,
    pullRequestNumber: null,
    trustMode: "standard" as const,
    safeModeReasons: [] as const,
  },
};

type Fixture = (typeof fixtures)[keyof typeof fixtures];
type QueryRow = Record<string, unknown>;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function audience(fixture: Fixture): string {
  const reasons = fixture.safeModeReasons.length > 0 ? fixture.safeModeReasons.join(",") : "none";
  return `boardreadyops-cloud:${fixture.runId}:${fixture.attemptId}:${fixture.trustMode}:${reasons}`;
}

function workflowRef(fixture: Fixture): string {
  return `${fixture.owner}/${fixture.name}/.github/workflows/readiness-runner.yml@refs/heads/main`;
}

function token(fixture: Fixture, overrides: Readonly<Record<string, unknown>> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" })).toString("base64url");
  const issuedAt = Math.floor(nowMs / 1000) - 10;
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: audience(fixture),
      sub: `repo:${fixture.owner}/${fixture.name}:ref:refs/heads/main`,
      repository: `${fixture.owner}/${fixture.name}`,
      repository_id: fixture.githubRepositoryId,
      workflow_ref: workflowRef(fixture),
      ref: "refs/heads/main",
      sha: fixture.commitSha,
      event_name: "workflow_dispatch",
      runner_environment: "github-hosted",
      run_id: String(fixture.checkRunId),
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + 300,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function resultBody(fixture: Fixture): Record<string, unknown> {
  return {
    version: 1,
    executionAttemptId: fixture.attemptId,
    status: "completed",
    conclusion: "success",
    decision: "pass",
    findings: [],
    artifacts: [],
    metrics: { durationMs: 1250, readinessScore: 100 },
    reportLinks: [],
    readiness: {
      score: 100,
      status: "ready",
      blocking: 0,
      nonBlocking: 0,
      missingRequired: [],
      missingRecommended: [],
      warnings: [],
    },
    waivers: { active: [], expired: [] },
  };
}

function callbackRequest(
  fixture: Fixture,
  bearer: string,
  options: {
    runId?: string;
    attemptId?: string;
    trustMode?: string;
    safeModeReasons?: string;
  } = {},
): Request {
  const url = new URL("https://boardreadyops.test/api/v1/runs/github-actions-result");
  url.searchParams.set("run_id", options.runId ?? fixture.runId);
  url.searchParams.set("attempt_id", options.attemptId ?? fixture.attemptId);
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      "x-boardreadyops-trust-mode": options.trustMode ?? fixture.trustMode,
      "x-boardreadyops-safe-mode-reasons": options.safeModeReasons ?? fixture.safeModeReasons.join(","),
    },
    body: JSON.stringify(resultBody(fixture)),
  });
}

async function stateSnapshot(): Promise<unknown> {
  if (!executor) throw new Error("DATABASE_URL is required");
  return rows(
    await executor.query(
      `select release_runs.id,
              release_runs.status,
              release_runs.version::int as version,
              release_runs.terminal_result_digest,
              release_run_attempts.status as attempt_status,
              release_run_attempts.version::int as attempt_version,
              release_run_attempts.result_digest,
              (select count(*)::int from release_run_results where run_id = release_runs.id) as results,
              (select count(*)::int from findings where run_id = release_runs.id) as findings,
              (select count(*)::int from artifacts where run_id = release_runs.id) as artifacts,
              (select count(*)::int from audit_events where release_run_id = release_runs.id) as audit_events
         from release_runs
         join release_run_attempts on release_run_attempts.id = release_runs.execution_attempt_id
        where release_runs.id = any($1::text[])
        order by release_runs.id`,
      [[fixtures.a.runId, fixtures.b.runId]],
    ),
  );
}

const checkRunPublications: QueryRow[] = [];
const jwksFetch = vi.fn(
  async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

const resultDependencies: ResultRouteDependencies = {
  queryExecutor: () => executor,
  checkRunClient: () =>
    ({
      completeCheckRun: async (input: QueryRow) => {
        checkRunPublications.push(input);
      },
    }) as never,
  detailsUrl: (runId) => `https://boardreadyops.test/runs/${runId}`,
  now: () => new Date(nowMs),
  verifyOidcToken: async () => false,
};

const routeDependencies: GitHubActionsResultRouteDependencies = {
  queryExecutor: () => executor,
  loadExpectations: resultOidcExpectations,
  verifyOidcToken: (bearer, expectations) =>
    verifyGitHubActionsOidcToken(bearer, {
      ...expectations,
      fetchImpl: jwksFetch,
      now: () => nowMs,
    }),
  handleResult: handleResultRequest,
  resultDependencies,
};

beforeAll(async () => {
  if (!executor) return;
  resetGitHubActionsOidcJwksCache();
  checkRunPublications.length = 0;
  await executor.query("delete from installations where id = any($1::text[])", [
    [fixtures.a.installationId, fixtures.b.installationId],
  ]);
  for (const fixture of Object.values(fixtures)) {
    await executor.query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, $2, $3, 'Organization')`,
      [fixture.installationId, fixture.githubInstallationId, fixture.owner],
    );
    await executor.query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       values ($1, $2, $3, $4, $5, $6, 'main')`,
      [
        fixture.repositoryId,
        fixture.installationId,
        fixture.githubRepositoryId,
        fixture.owner,
        fixture.name,
        fixture.private,
      ],
    );
    await executor.query(
      `insert into release_runs (
         id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status,
         execution_attempt_id, execution_attempt_started_at, started_at, github_check_run_id,
         trust_mode, safe_mode_reasons
       ) values ($1, $2, $3, 'refs/heads/main', $4, 'manual', 'running', $5,
                 $6::timestamptz, $6::timestamptz, $7, $8, $9::text[])`,
      [
        fixture.runId,
        fixture.repositoryId,
        fixture.commitSha,
        fixture.pullRequestNumber,
        fixture.attemptId,
        "2026-08-02T04:29:00.000Z",
        fixture.checkRunId,
        fixture.trustMode,
        [...fixture.safeModeReasons],
      ],
    );
    await executor.query(
      `insert into release_run_attempts (
         id, run_id, attempt_number, status, created_at, dispatch_requested_at,
         dispatched_at, started_at, github_workflow_dispatch_id
       ) values ($1, $2, 1, 'in_progress', $3::timestamptz, $3::timestamptz,
                 $3::timestamptz, $3::timestamptz, $4)`,
      [fixture.attemptId, fixture.runId, "2026-08-02T04:29:00.000Z", `workflow-${fixture.owner}`],
    );
  }
});

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where id = any($1::text[])", [
    [fixtures.a.installationId, fixtures.b.installationId],
  ]);
});

describeDatabase("target-repository GitHub Actions two-installation isolation", () => {
  it("accepts independent callbacks and rejects cross-installation, stale, claim-mutated, and trust-mutated callbacks", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");

    const acceptedA = await handleGitHubActionsResultRequest(
      callbackRequest(fixtures.a, token(fixtures.a)),
      routeDependencies,
    );
    expect(acceptedA.status).toBe(202);
    const acceptedABody = (await acceptedA.json()) as {
      publicationWarnings?: string[];
      [key: string]: unknown;
    };
    expect(acceptedABody).toMatchObject({
      ok: true,
      status: "accepted",
      checkRunUpdated: true,
      pullRequestCommentCreated: false,
      publicationWarnings: ["GitHub pull-request comment publication is not configured"],
    });

    const acceptedB = await handleGitHubActionsResultRequest(
      callbackRequest(fixtures.b, token(fixtures.b)),
      routeDependencies,
    );
    expect(acceptedB.status).toBe(202);
    await expect(acceptedB.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
      checkRunUpdated: true,
      pullRequestCommentCreated: false,
    });

    expect(checkRunPublications).toEqual([
      expect.objectContaining({
        installationId: String(fixtures.a.githubInstallationId),
        repositoryOwner: fixtures.a.owner,
        repositoryName: fixtures.a.name,
        checkRunId: String(fixtures.a.checkRunId),
        runId: fixtures.a.runId,
      }),
      expect.objectContaining({
        installationId: String(fixtures.b.githubInstallationId),
        repositoryOwner: fixtures.b.owner,
        repositoryName: fixtures.b.name,
        checkRunId: String(fixtures.b.checkRunId),
        runId: fixtures.b.runId,
      }),
    ]);

    const acceptedState = await stateSnapshot();
    const acceptedPublicationCount = checkRunPublications.length;
    const rejectedResponses: string[] = [];

    for (const [requestFixture, bearerFixture] of [
      [fixtures.b, fixtures.a],
      [fixtures.a, fixtures.b],
    ] as const) {
      const response = await handleGitHubActionsResultRequest(
        callbackRequest(requestFixture, token(bearerFixture)),
        routeDependencies,
      );
      expect(response.status).toBe(401);
      rejectedResponses.push(JSON.stringify(await response.json()));
    }

    const staleResponse = await handleGitHubActionsResultRequest(
      callbackRequest(fixtures.a, token(fixtures.a), {
        attemptId: "30000000-0000-4000-8000-000000000004",
      }),
      routeDependencies,
    );
    expect(staleResponse.status).toBe(401);
    rejectedResponses.push(JSON.stringify(await staleResponse.json()));

    const claimMutations = [
      { repository: `${fixtures.b.owner}/${fixtures.b.name}` },
      { repository_id: fixtures.b.githubRepositoryId },
      { workflow_ref: workflowRef(fixtures.b) },
      { ref: "refs/heads/feature" },
      { sha: "c".repeat(40) },
      { event_name: "pull_request" },
      { runner_environment: "self-hosted" },
    ];
    for (const mutation of claimMutations) {
      const response = await handleGitHubActionsResultRequest(
        callbackRequest(fixtures.a, token(fixtures.a, mutation)),
        routeDependencies,
      );
      expect(response.status).toBe(401);
      rejectedResponses.push(JSON.stringify(await response.json()));
    }

    for (const [fixture, trustMode, safeModeReasons] of [
      [fixtures.a, "standard", ""],
      [fixtures.b, "safe", "private-repository"],
    ] as const) {
      const response = await handleGitHubActionsResultRequest(
        callbackRequest(fixture, token(fixture), { trustMode, safeModeReasons }),
        routeDependencies,
      );
      expect(response.status).toBe(401);
      rejectedResponses.push(JSON.stringify(await response.json()));
    }

    expect(await stateSnapshot()).toEqual(acceptedState);
    expect(checkRunPublications).toHaveLength(acceptedPublicationCount);

    const forbidden = Object.values(fixtures).flatMap((fixture) => [
      fixture.owner,
      fixture.name,
      fixture.repositoryId,
      fixture.githubRepositoryId,
      fixture.installationId,
      String(fixture.githubInstallationId),
      fixture.runId,
      fixture.attemptId,
    ]);
    const leakageFindings = rejectedResponses.filter((body) => forbidden.some((value) => body.includes(value)));
    expect(leakageFindings).toEqual([]);

    const evidencePath = process.env.BOARDREADYOPS_ISOLATION_EVIDENCE_PATH;
    if (evidencePath) {
      const sourceSha = process.env.GITHUB_SHA ?? "";
      const evidence = {
        sourceSha,
        independentCallbacksAccepted: 2,
        independentCheckRunsPublished: 2,
        crossInstallationCallbacksRejected: 2,
        staleAttemptCallbacksRejected: 1,
        claimMutationCallbacksRejected: claimMutations.length,
        trustSnapshotCallbacksRejected: 2,
        rejectedCallbackMutations: 0,
        rejectedCallbackPublications: 0,
        optionalCommentWarnings: acceptedABody.publicationWarnings?.length ?? 0,
        responseLeakageFindings: leakageFindings.length,
      };
      await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      await fs.chmod(evidencePath, 0o600);
    }
  });
});
