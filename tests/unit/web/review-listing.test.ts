import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import { loadViewerReviews, reviewFixturesEnabled } from "../../../apps/web/lib/review-listing.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const listingQuery = vi.hoisted(() => vi.fn());
const listingClose = vi.hoisted(() => vi.fn());

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: () => ({ query: listingQuery, close: listingClose }),
}));

const session = { login: "octocat", installationIds: [42] } as unknown as UserSession;

/**
 * Every case states the deployment it means. Reading the ambient environment would make these
 * pass locally and fail in CI, which defines DATABASE_URL for the whole workflow.
 */
const withoutDatabase = {} as NodeJS.ProcessEnv;
const withDatabase = { DATABASE_URL: "postgres://user:pass@localhost:5432/app" } as NodeJS.ProcessEnv;

describe("reviewFixturesEnabled", () => {
  it("is on when the deployment has no Postgres, which is what the E2E suite runs against", () => {
    expect(reviewFixturesEnabled(withoutDatabase)).toBe(true);
  });

  it("is off once Postgres is configured, so real reviews are never shadowed by demo ones", () => {
    expect(reviewFixturesEnabled(withDatabase)).toBe(false);
  });

  it("is on for an explicit in-memory persistence mode", () => {
    // Memory persistence is only allowed outside production, so NODE_ENV is part of that state.
    const memory = { BOARDREADYOPS_PERSISTENCE_MODE: "memory", NODE_ENV: "test" } as NodeJS.ProcessEnv;
    expect(reviewFixturesEnabled(memory)).toBe(true);
  });
});

describe("loadViewerReviews", () => {
  it("serves the bundled demo reviews while fixtures are enabled, signed in or not", async () => {
    await expect(loadViewerReviews(undefined, { fixtures: DEMO_REVIEWS }, withoutDatabase)).resolves.toEqual({
      state: "fixtures",
      reviews: DEMO_REVIEWS,
    });
    await expect(loadViewerReviews(session, { fixtures: DEMO_REVIEWS }, withoutDatabase)).resolves.toMatchObject({
      state: "fixtures",
    });
  });

  it("returns an empty fixture list rather than throwing when the caller supplies none", async () => {
    await expect(loadViewerReviews(session, {}, withoutDatabase)).resolves.toEqual({
      state: "fixtures",
      reviews: [],
    });
  });

  it("treats a viewer with no installations as signed out once Postgres is configured", async () => {
    const noInstallations = { login: "octocat", installationIds: [] } as unknown as UserSession;
    await expect(loadViewerReviews(noInstallations, {}, withDatabase)).resolves.toEqual({ state: "signed-out" });
    await expect(loadViewerReviews(undefined, {}, withDatabase)).resolves.toEqual({ state: "signed-out" });
  });
});

describe("loadViewerReviews current-revision-generated titles", () => {
  beforeEach(() => {
    listingQuery.mockReset();
    listingClose.mockReset();
  });

  it.each([
    ["Review for 6aa49e71", "8714bbeb".padEnd(40, "0"), "Review for 8714bbeb"],
    ["Custom hardware design review", "8714bbeb".padEnd(40, "0"), "Custom hardware design review"],
    ["Review for 6aa49e71", null, "Review for 6aa49e71"],
    ["Review for 6aa49e71", "malformed", "Review for 6aa49e71"],
  ])("renders stored title %s and current SHA %s as %s", async (storedTitle, headSha, expectedTitle) => {
    listingQuery.mockResolvedValue({
      rows: [
        {
          id: "review_1",
          repository_id: "repo_1",
          owner: "acme",
          repository_name: "pcb",
          pull_request_number: 10,
          title: storedTitle,
          current_head_commit_sha: headSha,
          status: "active",
          decision: "pending",
          created_by: "alice",
          updated_at: "2026-11-02T12:00:00Z",
        },
      ],
    });

    const result = await loadViewerReviews(session, {}, withDatabase);
    expect(result).toMatchObject({ state: "ok", reviews: [{ title: expectedTitle }] });
    expect(listingQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = listingQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("current_revision.review_id = reviews.id");
    expect(sql).toContain("current_revision.head_commit_sha as current_head_commit_sha");
    expect(params).toEqual([[42], 50]);
    expect(listingClose).toHaveBeenCalledOnce();
  });
});
