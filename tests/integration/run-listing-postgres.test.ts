import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeRunListingCursor, encodeRunListingCursor, loadViewerRuns } from "../../apps/web/lib/run-listing.js";
import type { UserSession } from "../../apps/web/lib/user-session.js";

const liveRepoIds = vi.hoisted(() => vi.fn(async () => [49301, 49302, 49303]));
vi.mock("../../apps/web/lib/live-installation-repositories.js", () => ({
  resolveLiveInstallationRepositoryIds: liveRepoIds,
}));

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
  // One accepted Pass remains green; the other four Pass previews must not.
  const signedRun = runIds.at(-1);
  if (!signedRun) throw new Error("Missing fixture run");
  const attemptId = "9e100000-0000-4000-8000-000000000035";
  const digest = "d".repeat(64);
  await database().query(
    `insert into release_run_attempts (id, run_id, attempt_number, status, completed_at, result_digest)
     values ($1, $2, 1, 'completed', now(), $3)`,
    [attemptId, signedRun, digest],
  );
  await database().query(
    `update release_runs set execution_attempt_id = $2, execution_attempt_started_at = now(), terminal_result_digest = $3 where id = $1`,
    [signedRun, attemptId, digest],
  );
  await database().query(
    `insert into release_run_results
      (run_id, execution_attempt_id, contract_version, status, conclusion, decision, payload, result_digest)
     values ($1, $2, 1, 'completed', 'success', 'pass', '{}'::jsonb, $3)`,
    [signedRun, attemptId, digest],
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
    expect(page.runs[0]?.decision).toBe("pass");
    expect(page.runs.slice(1).every((run) => run.decision === "readiness_not_verified")).toBe(true);
    expect(page.runs.some((run) => run.id === theirsRunId)).toBe(false);
  });

  it("removes history when live GitHub selection no longer includes the previously connected repository", async () => {
    liveRepoIds.mockResolvedValueOnce([49303]);
    const outcome = await loadViewerRuns(session([mineGithubInstallation]), { limit: 100 }, environment);
    expect(outcome).toEqual({ state: "ok", runs: [], next: undefined });
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

  it("separates run history for two independent installations, including mixed-session access", async () => {
    const mine = await loadViewerRuns(session([mineGithubInstallation]), { limit: 100 }, environment);
    const theirs = await loadViewerRuns(session([theirsGithubInstallation]), { limit: 100 }, environment);
    const both = await loadViewerRuns(
      session([mineGithubInstallation, theirsGithubInstallation]),
      { limit: 100 },
      environment,
    );

    if (mine.state !== "ok" || theirs.state !== "ok" || both.state !== "ok") {
      throw new Error("expected scoped run history for each installation");
    }
    expect(mine.runs).toHaveLength(runIds.length);
    expect(mine.runs.every(({ repositoryId }) => repositoryId === mineRepository)).toBe(true);
    expect(theirs.runs.map(({ id }) => id)).toEqual([theirsRunId]);
    expect(theirs.runs.every(({ repositoryId }) => repositoryId === theirsRepository)).toBe(true);
    expect(both.runs.map(({ id }) => id)).toContain(theirsRunId);
    expect(both.runs.map(({ id }) => id)).toEqual(expect.arrayContaining(runIds));
    expect(both.runs).toHaveLength(runIds.length + 1);
  });

  it("hides a suspended installation immediately, even while its original viewer session is still valid", async () => {
    const oldSession = session([mineGithubInstallation]);
    const before = await loadViewerRuns(oldSession, { limit: 100 }, environment);
    if (before.state !== "ok") throw new Error("expected run listing before suspension");
    expect(before.runs).toHaveLength(runIds.length);

    await database().query("update installations set suspended_at = now() where id = $1", [mineInstallation]);
    try {
      const revoked = await loadViewerRuns(oldSession, { limit: 100 }, environment);
      if (revoked.state !== "ok") throw new Error("expected a scoped listing after suspension");
      expect(revoked.runs).toEqual([]);
      expect(revoked.next).toBeUndefined();

      // Suspension of installation A must not hide installation B.
      const foreign = await loadViewerRuns(session([theirsGithubInstallation]), { limit: 100 }, environment);
      if (foreign.state !== "ok") throw new Error("expected independent installation listing");
      expect(foreign.runs.map(({ id }) => id)).toEqual([theirsRunId]);
    } finally {
      await database().query("update installations set suspended_at = null where id = $1", [mineInstallation]);
    }

    const restored = await loadViewerRuns(oldSession, { limit: 100 }, environment);
    if (restored.state !== "ok") throw new Error("expected original installation listing after restoration");
    expect(restored.runs).toHaveLength(runIds.length);
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
