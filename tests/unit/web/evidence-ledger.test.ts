import { describe, expect, it, vi } from "vitest";
import { loadEvidenceLedger } from "../../../apps/web/lib/evidence-ledger.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const query = vi.fn();
const close = vi.fn();

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

const session: UserSession = {
  userId: 1,
  login: "octocat",
  installationIds: [900001],
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

/** A deployment with Postgres, stated explicitly rather than inherited from process.env. */
const postgres = { DATABASE_URL: "postgresql://user@localhost:5432/db" } as NodeJS.ProcessEnv;

function row(overrides: Record<string, unknown> = {}) {
  return {
    revision_id: "rev_1",
    review_id: "review_1",
    sequence: 3,
    head_commit_sha: "a".repeat(40),
    base_commit_sha: "b".repeat(40),
    evidence_digest: "c".repeat(64),
    created_at: "2026-09-01T10:00:00.000Z",
    review_title: "Gateway board rev C",
    decision: "approved",
    review_status: "completed",
    pull_request_number: 42,
    owner: "acme",
    repository_name: "gateway",
    ...overrides,
  };
}

describe("loadEvidenceLedger", () => {
  it("maps a revision row into a ledger entry", async () => {
    query.mockReset().mockResolvedValue({ rows: [row()] });

    const result = await loadEvidenceLedger(session, {}, postgres);

    expect(result).toEqual({
      state: "ok",
      entries: [
        {
          revisionId: "rev_1",
          reviewId: "review_1",
          reviewTitle: "Gateway board rev C",
          repositoryName: "acme/gateway",
          pullRequestNumber: 42,
          sequence: 3,
          headCommitSha: "a".repeat(40),
          baseCommitSha: "b".repeat(40),
          evidenceDigest: "c".repeat(64),
          decision: "approved",
          reviewStatus: "completed",
          createdAt: "2026-09-01T10:00:00.000Z",
        },
      ],
    });
  });

  it("scopes the query to the session's installations", async () => {
    query.mockReset().mockResolvedValue({ rows: [] });

    await loadEvidenceLedger(session, {}, postgres);

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    // The tenant boundary is this WHERE clause and nothing else; a listing that forgot it would
    // read every tenant's evidence.
    expect(sql).toContain("installations.github_installation_id = any($1::bigint[])");
    expect(parameters[0]).toEqual([900001]);
  });

  it("drops a revision that has no digest, because it cannot be verified", async () => {
    // A ledger row whose digest is missing is not evidence. Showing it would put a line on the
    // page that `release verify` can never match.
    query.mockReset().mockResolvedValue({ rows: [row(), row({ revision_id: "rev_2", evidence_digest: null })] });

    const result = await loadEvidenceLedger(session, {}, postgres);

    expect(result.state).toBe("ok");
    expect(result.state === "ok" && result.entries.map((entry) => entry.revisionId)).toEqual(["rev_1"]);
  });

  it("drops a revision with no head commit for the same reason", async () => {
    query.mockReset().mockResolvedValue({ rows: [row({ head_commit_sha: null })] });

    const result = await loadEvidenceLedger(session, {}, postgres);
    expect(result.state === "ok" && result.entries).toEqual([]);
  });

  it("reads a bigint sequence that the driver returned as a string", async () => {
    query.mockReset().mockResolvedValue({ rows: [row({ sequence: "7", pull_request_number: "42" })] });

    const result = await loadEvidenceLedger(session, {}, postgres);
    expect(result.state === "ok" && result.entries[0]?.sequence).toBe(7);
    expect(result.state === "ok" && result.entries[0]?.pullRequestNumber).toBe(42);
  });

  it("reports not-configured rather than inventing a digest without a database", async () => {
    query.mockReset();

    // Every other listing falls back to fixtures here. This one must not: a fabricated digest is
    // the single thing on the page that would be a lie, since its whole value is being checkable.
    await expect(loadEvidenceLedger(session, {}, {} as NodeJS.ProcessEnv)).resolves.toEqual({
      state: "not-configured",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports signed-out for a viewer with no installations", async () => {
    query.mockReset();

    await expect(loadEvidenceLedger({ ...session, installationIds: [] }, {}, postgres)).resolves.toEqual({
      state: "signed-out",
    });
    await expect(loadEvidenceLedger(undefined, {}, postgres)).resolves.toEqual({ state: "signed-out" });
    expect(query).not.toHaveBeenCalled();
  });

  it("clamps the page size so a hand-edited limit cannot ask for the whole table", async () => {
    query.mockReset().mockResolvedValue({ rows: [] });

    await loadEvidenceLedger(session, { limit: 100_000 }, postgres);
    expect((query.mock.calls[0] as [string, unknown[]])[1][1]).toBe(200);

    await loadEvidenceLedger(session, { limit: 0 }, postgres);
    expect((query.mock.calls[1] as [string, unknown[]])[1][1]).toBe(1);
  });

  it("closes the connection even when the query throws", async () => {
    close.mockReset();
    query.mockReset().mockRejectedValue(new Error("connection reset"));

    await expect(loadEvidenceLedger(session, {}, postgres)).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
