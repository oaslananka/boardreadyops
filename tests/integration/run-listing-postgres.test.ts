import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeRunListingCursor, encodeRunListingCursor, loadViewerRuns } from "../../apps/web/lib/run-listing.js";
import type { UserSession } from "../../apps/web/lib/user-session.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const environment = { DATABASE_URL: connectionString };

const mineInstallation = "9e100000-0000-4000-8000-000000000001";
const theirsInstallation = "9e100000-0000-4000-8000-000000000002";
const mineRepository = "9e100000-0000-4000-8000-000000000011";
const theirsRepository = "9e100000-0000-4000-8000-000000000012";
const disabledRepository = "9e100000-0000-4000-8000-000000000013";
const mineGithubInstallation = 49_201;
const theirsGithubInstallation = 49_202;
const runIds = Array.from(
  { length: 5 },
  (_unused, index) => `9e100000-0000-4000-8000-0000000000${(30 + index).toString().padStart(2, "0")}`,
);
const theirsRunId = "9e100000-0000-4000-8000-000000000099";

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function session(installationIds: number[]): UserSession {
  return {
    userId: 11,
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
     values ($1, $2, 'listing-mine-org', 'Organization'), ($3, $4, 'listing-theirs-org', 'Organization')`,
    [mineInstallation, mineGithubInstallation, theirsInstallation, theirsGithubInstallation],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch, disabled_at)
     values ($1, $2, 49301, 'listing-mine-org', 'board-a', true, 'main', null),
            ($3, $4, 49302, 'listing-theirs-org', 'board-b', false, 'main', null),
            ($5, $2, 49303, 'listing-mine-org', 'board-disabled', false, 'main', now())`,
    [mineRepository, mineInstallation, theirsRepository, theirsInstallation, disabledRepository],
  );

  // Five runs on the visible repository, oldest first, one minute apart, so keyset pagination
  // has a deterministic order to walk. Plus one run on another tenant's repository.
  for (const [index, runId] of runIds.entries()) {
    await database().query(
      `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, decision, started_at)
       values ($1, $2, $3, 'refs/heads/main', 'pull_request', 'completed', 'pass', now() - ($4 || ' minutes')::interval)`,
      [runId, mineRepository, `${index}`.repeat(40).slice(0, 40), String(runIds.length - index)],
    );
  }
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, decision, started_at)
     values ($1, $2, $3, 'refs/heads/main', 'pull_request', 'completed', 'pass', now())`,
    [theirsRunId, theirsRepository, "f".repeat(40)],
  );
});

afterAll(async () => {
  if (!executor) return;
  for (const id of [mineInstallation, theirsInstallation]) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await executor.close();
});

describeDatabase("viewer run listing", () => {
  it("lists only runs the session's installations reach, newest first", async () => {
    const page = await loadViewerRuns(session([mineGithubInstallation]), { limit: 100 }, environment);
    if (page.state !== "ok") throw new Error(`expected ok, got ${page.state}`);

    expect(page.runs.map((run) => run.id)).toEqual([...runIds].reverse());
    expect(page.runs.some((run) => run.id === theirsRunId)).toBe(false);
  });

  it("excludes runs under a disabled repository", async () => {
    const page = await loadViewerRuns(session([mineGithubInstallation]), { limit: 100 }, environment);
    if (page.state !== "ok") throw new Error(`expected ok, got ${page.state}`);

    expect(page.runs.every((run) => run.repositoryId !== disabledRepository)).toBe(true);
  });

  it("paginates with a stable keyset cursor that never repeats or skips a row", async () => {
    const seen: string[] = [];
    let cursor: ReturnType<typeof decodeRunListingCursor>;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await loadViewerRuns(
        session([mineGithubInstallation]),
        { limit: 2, ...(cursor ? { cursor } : {}) },
        environment,
      );
      if (page.state !== "ok") throw new Error(`expected ok, got ${page.state}`);
      seen.push(...page.runs.map((run) => run.id));
      if (!page.next) break;
      cursor = decodeRunListingCursor(page.next);
    }

    expect(seen).toEqual([...runIds].reverse());
  });

  it("stays scoped to the caller's tenant even when the cursor points at another tenant's row", async () => {
    // The cursor is unsigned by design (see run-listing.ts): it only resumes a keyset scan
    // inside a query independently scoped by the caller's own installation ids. A well-formed
    // cursor built from another tenant's row must still surface nothing outside that scope.
    const foreignCursor = encodeRunListingCursor({ startedAt: new Date().toISOString(), id: theirsRunId });
    const cursor = decodeRunListingCursor(foreignCursor);
    if (!cursor) throw new Error("expected the encoded cursor to decode");

    const page = await loadViewerRuns(session([mineGithubInstallation]), { cursor, limit: 100 }, environment);
    if (page.state !== "ok") throw new Error(`expected ok, got ${page.state}`);

    expect(page.runs.some((run) => run.id === theirsRunId)).toBe(false);
  });

  it("returns an empty page for a signed-out viewer or one with no installations", async () => {
    expect(await loadViewerRuns(undefined, {}, environment)).toEqual({ state: "ok", runs: [], next: undefined });
    expect(await loadViewerRuns(session([]), {}, environment)).toEqual({ state: "ok", runs: [], next: undefined });
  });

  it("reports not-configured rather than an empty page when DATABASE_URL is absent", async () => {
    const result = await loadViewerRuns(session([mineGithubInstallation]), {}, { DATABASE_URL: undefined });
    expect(result).toEqual({ state: "not-configured" });
  });
});
