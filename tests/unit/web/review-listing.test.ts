import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import { loadViewerReviews, reviewFixturesEnabled } from "../../../apps/web/lib/review-listing.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const session = { login: "octocat", installationIds: [42] } as unknown as UserSession;

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.unstubAllEnvs();
});

describe("reviewFixturesEnabled", () => {
  it("is on when this deployment has no Postgres, which is what the E2E suite runs against", () => {
    expect(reviewFixturesEnabled()).toBe(true);
  });
});

describe("loadViewerReviews", () => {
  it("serves the bundled demo reviews while fixtures are enabled, signed in or not", async () => {
    await expect(loadViewerReviews(undefined, { fixtures: DEMO_REVIEWS })).resolves.toEqual({
      state: "fixtures",
      reviews: DEMO_REVIEWS,
    });
    await expect(loadViewerReviews(session, { fixtures: DEMO_REVIEWS })).resolves.toMatchObject({
      state: "fixtures",
    });
  });

  it("returns an empty fixture list rather than throwing when the caller supplies none", async () => {
    await expect(loadViewerReviews(session)).resolves.toEqual({ state: "fixtures", reviews: [] });
  });

  it("treats a viewer with no installations as signed out once Postgres is configured", async () => {
    vi.stubEnv("CLOUD_PERSISTENCE", "postgres");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/app");
    const noInstallations = { login: "octocat", installationIds: [] } as unknown as UserSession;
    await expect(loadViewerReviews(noInstallations)).resolves.toEqual({ state: "signed-out" });
    await expect(loadViewerReviews(undefined)).resolves.toEqual({ state: "signed-out" });
  });
});
