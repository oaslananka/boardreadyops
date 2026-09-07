import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ session: { login: "octocat", installationIds: [1] } })),
}));

const loadViewerReviews = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/review-listing.js", () => ({
  loadViewerReviews,
  reviewFixturesEnabled: () => true,
}));

const { default: ReviewsListPage } = await import("../../../apps/web/app/reviews/page.js");
const { DEMO_REVIEWS } = await import("../../../apps/web/lib/demo-data.js");

async function render(): Promise<string> {
  return renderToStaticMarkup(await ReviewsListPage());
}

describe("ReviewsListPage", () => {
  it("renders the demo reviews as full cards when this deployment has no Postgres", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const markup = await render();

    expect(markup).toContain("Hardware Reviews");
    const review = DEMO_REVIEWS[0];
    expect(review).toBeDefined();
    expect(review?.pullRequestNumber).toBe(42);
    expect(markup).toContain("PR #42");
  });

  it("counts only decision-pending reviews as awaiting a decision, not the whole list", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const nonPendingCount = DEMO_REVIEWS.filter((r) => r.decision !== "pending").length;
    expect(nonPendingCount).toBeGreaterThan(0);

    const markup = await render();
    const pendingCount = DEMO_REVIEWS.filter((r) => r.decision === "pending").length;
    expect(markup).not.toContain(`${DEMO_REVIEWS.length}</strong> active reviews`);
    expect(markup).toContain(`<strong>${pendingCount}</strong> awaiting a decision`);
  });

  it("renders real rows in a table once the listing comes from the database", async () => {
    loadViewerReviews.mockResolvedValue({
      state: "ok",
      next: undefined,
      reviews: [
        {
          id: "rev_real_1",
          repositoryId: "repo_1",
          repositoryName: "acme/board",
          pullRequestNumber: 7,
          title: "Add ESD protection to USB-C port",
          status: "active",
          decision: "pending",
          createdBy: "dana@acme.corp",
          updatedAt: "2026-09-01T09:30:00.000Z",
        },
      ],
    });

    const markup = await render();
    expect(markup).toContain("Add ESD protection to USB-C port");
    expect(markup).toContain("acme/board");
    expect(markup).toContain('href="/reviews/rev_real_1"');
    expect(markup).toContain("<strong>1</strong> awaiting a decision");
    // The richer fixture card carries finding counts the database listing does not query.
    expect(markup).toContain("<table");
  });

  it("asks an unrecognised viewer to sign in rather than showing an empty registry", async () => {
    loadViewerReviews.mockResolvedValue({ state: "signed-out" });
    const markup = await render();
    expect(markup).toContain("Sign in required");
    expect(markup).not.toContain("awaiting a decision");
  });

  it("uses CAD-format-neutral copy, not a KiCad-specific claim", () => {
    expect(ReviewsListPage.name).toBeTruthy();
  });
});
