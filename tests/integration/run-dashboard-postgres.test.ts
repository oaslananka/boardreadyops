import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lookupRunDashboard } from "../../apps/web/lib/run-dashboard.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "7a000000-0000-4000-8000-000000000001";
const repositoryId = "7a000000-0000-4000-8000-000000000002";
const runId = "7a000000-0000-4000-8000-000000000003";
const otherInstallationId = "7a000000-0000-4000-8000-000000000011";
const otherRepositoryId = "7a000000-0000-4000-8000-000000000012";

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

beforeAll(async () => {
  if (!executor) return;
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 47001, 'dashboard-integration', 'Organization')`,
    [installationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, 47011, 'dashboard-integration', 'large-board', 'main', false)`,
    [repositoryId, installationId],
  );
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, 47002, 'dashboard-other', 'Organization')`,
    [otherInstallationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, 47012, 'dashboard-other', 'isolated-board', 'main', true)`,
    [otherRepositoryId, otherInstallationId],
  );
  await database().query(
    `insert into release_runs (
       id, repository_id, commit_sha, ref, pull_request_number, trigger_kind,
       status, decision, completed_at, duration_ms, readiness_score, trust_mode, safe_mode_reasons
     ) values ($1, $2, $3, 'refs/heads/main', 221, 'pr', 'completed', 'pass', now(), 1250, 97,
               'safe', array['private-repository']::text[])`,
    [runId, repositoryId, "d".repeat(40)],
  );
  await database().query(
    `insert into release_run_results (
       run_id, contract_version, status, conclusion, decision, metrics,
       report_links, payload, result_digest, received_at
     ) values ($1, 1, 'completed', 'success', 'pass', $2::jsonb, '[]'::jsonb, $3::jsonb, $4, now())`,
    [runId, JSON.stringify({ readinessScore: 97 }), JSON.stringify({ schemaVersion: 1 }), "e".repeat(64)],
  );
  await database().query(
    `insert into findings (run_id, rule_id, severity, message, path, kind)
     select $1, 'rule.' || lpad(series::text, 2, '0'), 'high',
            'Finding ' || series, 'hardware/board-' || series || '.kicad_pcb', 'drc'
       from generate_series(1, 31) as series`,
    [runId],
  );
  await database().query(
    `insert into artifacts (run_id, kind, name, storage_path, sha256, bytes, role, uploaded_at)
     values
       ($1, 'report', 'small.html', 'runs/small.html', $2, 1024, 'evidence', now() - interval '2 seconds'),
       ($1, 'report', 'large.html', 'runs/large.html', $3, 4096, 'evidence', now() - interval '1 second'),
       ($1, 'archive', 'board.zip', 'runs/board.zip', $4, 2048, 'primary', now())`,
    [runId, "a".repeat(64), "b".repeat(64), "c".repeat(64)],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id in ($1, $2)", [installationId, otherInstallationId]);
  await executor.close();
});

describeDatabase("run dashboard PostgreSQL integration", () => {
  it("fails closed when a run is presented under another installation or repository scope", async () => {
    await expect(
      lookupRunDashboard(runId, database(), {
        scope: { installationId: otherInstallationId, repositoryId },
      }),
    ).resolves.toEqual({ state: "not-found" });

    await expect(
      lookupRunDashboard(runId, database(), {
        scope: { installationId, repositoryId: otherRepositoryId },
      }),
    ).resolves.toEqual({ state: "not-found" });

    const authorized = await lookupRunDashboard(runId, database(), {
      scope: { installationId, repositoryId },
    });
    expect(authorized).toMatchObject({
      state: "found",
      run: { repository: "dashboard-integration/large-board" },
    });
  });

  it("filters, sorts, and pages large run-owned result sets without exposing storage paths", async () => {
    const result = await lookupRunDashboard(runId, database(), {
      filters: {
        findingSeverity: "high",
        findingSort: "rule",
        findingsPage: 2,
        artifactKind: "report",
        artifactSort: "size",
        pageSize: 10,
      },
    });

    expect(result.state).toBe("found");
    if (result.state !== "found") throw new Error("dashboard fixture was not found");
    expect(result.run.trustMode).toBe("safe");
    expect(result.run.safeModeReasons).toEqual(["private-repository"]);
    expect(result.run.findingsPage).toEqual({ page: 2, pageSize: 10, total: 31, totalPages: 4 });
    expect(result.run.findings).toHaveLength(10);
    expect(result.run.findings[0]?.ruleId).toBe("rule.11");
    expect(result.run.artifactsPage).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
    expect(result.run.artifacts.map((artifact) => artifact.name)).toEqual(["large.html", "small.html"]);
    expect(result.run.artifacts.every((artifact) => artifact.availability === "metadata-only")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("runs/large.html");
  });
});
