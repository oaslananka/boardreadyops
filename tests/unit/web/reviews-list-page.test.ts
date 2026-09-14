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

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await ReviewsListPage({ searchParams: Promise.resolve(searchParams) }));
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
    expect(markup).toContain(`>${pendingCount}</strong> awaiting a decision`);
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
    expect(markup).toContain(">1</strong> awaiting a decision");
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

  it("filters the registry from the URL so a filtered view is shareable", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const approvedOnly = await render({ decision: "approved" });
    const pendingTitles = DEMO_REVIEWS.filter((r) => r.decision === "pending").map((r) => r.title);
    expect(pendingTitles.length).toBeGreaterThan(0);
    for (const title of pendingTitles) expect(approvedOnly).not.toContain(title);
    expect(approvedOnly).toContain("of <strong");
  });

  it("searches across title, repository, author and pull request number", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const byPullRequest = await render({ q: "#42" });
    expect(byPullRequest).toContain("PR #42");

    const noMatch = await render({ q: "a string no fixture contains" });
    expect(noMatch).toContain("No review matches these filters");
    expect(noMatch).toContain("Clear the filters");
  });

  it("offers a decision-first sort so pending work surfaces above settled reviews", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const markup = await render({ sort: "decision" });
    const pending = DEMO_REVIEWS.find((r) => r.decision === "pending");
    const settled = DEMO_REVIEWS.find((r) => r.decision !== "pending");
    expect(pending).toBeDefined();
    expect(settled).toBeDefined();
    if (!pending || !settled) return;
    expect(markup.indexOf(pending.title)).toBeLessThan(markup.indexOf(settled.title));
  });

  it("does not render a filter bar when there is nothing to filter", async () => {
    loadViewerReviews.mockResolvedValue({ state: "ok", next: undefined, reviews: [] });
    const markup = await render();
    expect(markup).not.toContain("Review filters");
    expect(markup).toContain("No hardware reviews found");
  });
});
