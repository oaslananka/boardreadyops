import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRepositoryDetail, loadViewerRepositories } from "../../apps/web/lib/repository-dashboard.js";
import type { UserSession } from "../../apps/web/lib/user-session.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const environment = { DATABASE_URL: connectionString };

const mineInstallation = "9e000000-0000-4000-8000-000000000001";
const theirsInstallation = "9e000000-0000-4000-8000-000000000002";
const mineRepository = "9e000000-0000-4000-8000-000000000011";
const theirsRepository = "9e000000-0000-4000-8000-000000000012";
const emptyRepository = "9e000000-0000-4000-8000-000000000013";
const runOne = "9e000000-0000-4000-8000-000000000021";
const runTwo = "9e000000-0000-4000-8000-000000000022";
const mineGithubInstallation = 49_101;
const theirsGithubInstallation = 49_102;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function session(installationIds: number[]): UserSession {
  return {
    userId: 7,
    login: "octocat",
    installationIds,
    issuedAt: "2026-08-25T08:00:00.000Z",
    expiresAt: "2026-08-26T08:00:00.000Z",
  };
}

beforeAll(async () => {
  if (!executor) return;
  for (const id of [mineInstallation, theirsInstallation]) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, 'mine-org', 'Organization'), ($3, $4, 'theirs-org', 'Organization')`,
    [mineInstallation, mineGithubInstallation, theirsInstallation, theirsGithubInstallation],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, 49201, 'mine-org', 'board-a', true, 'main'),
            ($3, $4, 49202, 'theirs-org', 'board-b', false, 'main'),
            ($5, $2, 49203, 'mine-org', 'board-quiet', false, 'main')`,
    [mineRepository, mineInstallation, theirsRepository, theirsInstallation, emptyRepository],
  );

  // Two runs on the visible repository; only the newest one's findings should be counted.
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, decision, started_at)
     values ($1, $2, $3, 'refs/heads/main', 'pull_request', 'completed', 'pass', now() - interval '2 hours'),
            ($4, $2, $5, 'refs/heads/main', 'pull_request', 'completed', 'fail', now() - interval '1 hour')`,
    [runOne, mineRepository, "a".repeat(40), runTwo, "b".repeat(40)],
  );
  await database().query(
    `insert into findings (id, run_id, rule_id, severity, message, kind)
     values ('9e000000-0000-4000-8000-000000000031', $1, 'old.rule', 'high', 'stale', 'drc'),
            ('9e000000-0000-4000-8000-000000000032', $2, 'new.rule', 'high', 'current', 'drc'),
            ('9e000000-0000-4000-8000-000000000033', $2, 'waived.rule', 'high', 'accepted', 'drc')`,
    [runOne, runTwo],
  );
  await database().query("update findings set waived_at = now() where rule_id = 'waived.rule'");
});

afterAll(async () => {
  if (!executor) return;
  for (const id of [mineInstallation, theirsInstallation]) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await executor.close();
});

describeDatabase("repository dashboard", () => {
  it("lists only repositories the session's installations reach", async () => {
    const groups = await loadViewerRepositories(session([mineGithubInstallation]), environment);
    const names = groups.flatMap((group) => group.repositories.map((entry) => `${entry.owner}/${entry.name}`));

    // The scoping is in the query, so another tenant's repository is never selected rather
    // than being fetched and then hidden.
    expect(names).toContain("mine-org/board-a");
    expect(names).not.toContain("theirs-org/board-b");
  });

  it("groups repositories by the account that owns them", async () => {
    const groups = await loadViewerRepositories(
      session([mineGithubInstallation, theirsGithubInstallation]),
      environment,
    );

    expect(groups.map((group) => group.accountLogin).sort()).toEqual(["mine-org", "theirs-org"]);
  });

  it("counts findings from the newest run only, excluding waived ones", async () => {
    const groups = await loadViewerRepositories(session([mineGithubInstallation]), environment);
    const repository = groups.flatMap((group) => group.repositories).find((entry) => entry.name === "board-a");

    // Older runs describe commits nobody is shipping, and a waived finding is a decision
    // someone already made.
    expect(repository?.openFindings).toBe(1);
    expect(repository?.latestRunDecision).toBe("fail");
  });

  it("reports a repository with no runs rather than omitting it", async () => {
    const groups = await loadViewerRepositories(session([mineGithubInstallation]), environment);
    const quiet = groups.flatMap((group) => group.repositories).find((entry) => entry.name === "board-quiet");

    // A repository that has never run is exactly what a new customer needs to see.
    expect(quiet).toBeDefined();
    expect(quiet?.latestRunId).toBeUndefined();
  });

  it("returns nothing for a signed-out viewer", async () => {
    expect(await loadViewerRepositories(undefined, environment)).toEqual([]);
    expect(await loadViewerRepositories(session([]), environment)).toEqual([]);
  });

  it("loads run history for a repository the viewer can see", async () => {
    const detail = await loadRepositoryDetail(mineRepository, session([mineGithubInstallation]), environment);

    expect(detail?.runs.map((run) => run.decision)).toEqual(["fail", "pass"]);
    expect(detail?.runs[0]?.findingCount).toBe(1);
  });

  it("answers the same for another tenant's repository as for one that does not exist", async () => {
    const foreign = await loadRepositoryDetail(theirsRepository, session([mineGithubInstallation]), environment);
    const missing = await loadRepositoryDetail(
      "9e000000-0000-4000-8000-0000000000ff",
      session([mineGithubInstallation]),
      environment,
    );

    // Distinguishable answers would let the page be used to probe for enrolled repositories.
    expect(foreign).toBeUndefined();
    expect(missing).toBeUndefined();
  });
});
