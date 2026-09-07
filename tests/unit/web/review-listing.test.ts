import { describe, expect, it } from "vitest";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import { loadViewerReviews, reviewFixturesEnabled } from "../../../apps/web/lib/review-listing.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

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
