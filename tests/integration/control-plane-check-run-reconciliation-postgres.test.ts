import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../packages/db/src/control-plane-operations-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const testPrefix = `check-run-reconcile-${randomUUID()}`;
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

type TerminalFixture = {
  installationId: string;
  repositoryId: string;
  releaseRunId: string;
  githubInstallationId: number;
  githubCheckRunId: number;
};

async function createTerminalFixture(label: string, conclusion: "failure" | "success"): Promise<TerminalFixture> {
  const staleAt = new Date(Date.now() - 10 * 60 * 1000);
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const releaseRunId = randomUUID();
  const githubInstallationId = externalIdSeed + (label === "success" ? 1 : 11);
  const githubRepositoryId = externalIdSeed + (label === "success" ? 2 : 12);
  const githubCheckRunId = externalIdSeed + (label === "success" ? 3 : 13);
  const runStatus = conclusion === "success" ? "completed" : "failed";
  const decision = conclusion === "success" ? "pass" : "fail";

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
    [repositoryId, installationId, githubRepositoryId, `${label}-board`],
  );
  await database().query(
    `insert into release_runs (
       id, repository_id, idempotency_key, commit_sha, ref, trigger_kind,
       status, decision, started_at, completed_at, duration_ms, github_check_run_id
     ) values (
       $1, $2, $3, $4, 'refs/heads/main', 'push',
       $5, $6, $7::timestamptz, $7::timestamptz, 1000, $8::bigint
     )`,
    [
      releaseRunId,
      repositoryId,
      `${testPrefix}:${releaseRunId}`,
      "a".repeat(40),
      runStatus,
      decision,
      staleAt.toISOString(),
      githubCheckRunId,
    ],
  );
  await database().query(
    `insert into release_run_results (
       run_id, contract_version, status, conclusion, decision,
       metrics, report_links, payload, result_digest, received_at
     ) values (
       $1, 1, $2, $3, $4,
       '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, $5, $6::timestamptz
     )`,
    [releaseRunId, runStatus, conclusion, decision, "b".repeat(64), staleAt.toISOString()],
  );

  return { installationId, repositoryId, releaseRunId, githubInstallationId, githubCheckRunId };
}

describeDatabase("GitHub Check Run PostgreSQL reconciliation", () => {
  it("detects, leases, and atomically repairs terminal publication state", async () => {
    const fixture = await createTerminalFixture("success", "success");
    const now = new Date();
    const store = createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 });

    await expect(
      store.detectCheckRunReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(1);
    await expect(
      store.detectCheckRunReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(0);

    const claimed = (await store.claimCheckRunReconciliationItems({ workerId: `${testPrefix}-worker`, limit: 1 }))[0];
    if (!claimed) throw new Error("expected one Check Run reconciliation item");
    expect(claimed).toMatchObject({
      installationId: fixture.installationId,
      repositoryId: fixture.repositoryId,
      releaseRunId: fixture.releaseRunId,
      subjectType: "release_run",
      subjectId: fixture.releaseRunId,
      reasonCode: "reporting_stale",
      attemptCount: 1,
    });

    await expect(
      store.loadCheckRunReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-other-worker`,
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.loadCheckRunReconciliationContext({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-worker`,
      }),
    ).resolves.toMatchObject({
      githubInstallationId: fixture.githubInstallationId,
      repositoryOwner: "octo-org",
      repositoryName: "success-board",
      releaseRunId: fixture.releaseRunId,
      githubCheckRunId: fixture.githubCheckRunId,
      runStatus: "completed",
      expectedConclusion: "success",
    });

    await expect(
      store.applyCheckRunReconciliation({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-worker`,
        observedStatus: "completed",
        observedConclusion: "success",
        action: "observed_current",
      }),
    ).resolves.toBe("applied");

    expect(
      rows(
        await database().query(
          `select
             rr.status as run_status,
             rrr.github_check_published_at is not null as check_published,
             rrr.last_publication_error,
             cpri.status as reconciliation_status,
             cpri.repaired,
             count(ae.id)::int as audit_count
           from release_runs rr
           join release_run_results rrr on rrr.run_id = rr.id
           join control_plane_reconciliation_items cpri on cpri.release_run_id = rr.id
           left join audit_events ae
             on ae.release_run_id = rr.id
            and ae.event_type = 'control_plane.github_check_run_reconciled'
          where rr.id = $1
          group by rr.status, rrr.github_check_published_at, rrr.last_publication_error,
                   cpri.status, cpri.repaired`,
          [fixture.releaseRunId],
        ),
      )[0],
    ).toEqual({
      run_status: "completed",
      check_published: true,
      last_publication_error: null,
      reconciliation_status: "completed",
      repaired: true,
      audit_count: 1,
    });
  });

  it("records a stable publication failure without changing the accepted terminal result", async () => {
    const fixture = await createTerminalFixture("failure", "failure");
    const now = new Date();
    const store = createSqlControlPlaneOperationsStore(database(), { now: () => now, leaseSeconds: 60 });
    await store.detectCheckRunReconciliationCandidates({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1800,
      limit: 10,
    });
    const claimed = (await store.claimCheckRunReconciliationItems({ workerId: `${testPrefix}-worker`, limit: 1 }))[0];
    if (!claimed) throw new Error("expected one Check Run reconciliation item");

    await expect(
      store.finalizeCheckRunReconciliationFailure({
        reconciliationId: claimed.reconciliationId,
        workerId: `${testPrefix}-worker`,
        observedStatus: "not_found",
        publicFailureReason: "github_check_run_not_found",
      }),
    ).resolves.toBe("failed");

    expect(
      rows(
        await database().query(
          `select
             rr.status as run_status,
             rrr.conclusion,
             rrr.github_check_published_at,
             rrr.last_publication_error,
             cpri.status as reconciliation_status,
             cpri.public_failure_reason,
             count(ae.id)::int as audit_count
           from release_runs rr
           join release_run_results rrr on rrr.run_id = rr.id
           join control_plane_reconciliation_items cpri on cpri.release_run_id = rr.id
           left join audit_events ae
             on ae.release_run_id = rr.id
            and ae.event_type = 'control_plane.github_check_run_reconciliation_failed'
          where rr.id = $1
          group by rr.status, rrr.conclusion, rrr.github_check_published_at,
                   rrr.last_publication_error, cpri.status, cpri.public_failure_reason`,
          [fixture.releaseRunId],
        ),
      )[0],
    ).toEqual({
      run_status: "failed",
      conclusion: "failure",
      github_check_published_at: null,
      last_publication_error: "github_check_run_not_found",
      reconciliation_status: "completed",
      public_failure_reason: "github_check_run_not_found",
      audit_count: 1,
    });

    await expect(
      store.detectCheckRunReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 10,
      }),
    ).resolves.toBe(0);
  });
});
