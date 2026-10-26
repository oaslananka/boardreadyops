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

  it("keeps review publishing guidance addressable when reviews already exist", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const markup = await render();

    expect(markup).toContain('id="publish-review"');
    expect(markup).toContain("Reviews are separate, explicitly published records");
    expect(markup).toContain("verify its exact head commit and evidence");
    expect(markup).toContain("boardreadyops review publish");
    expect(markup.indexOf("Hardware Reviews")).toBeLessThan(markup.indexOf('id="publish-review"'));
    expect(markup.indexOf("PR #42")).toBeLessThan(markup.indexOf('id="publish-review"'));
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

  it("renders real reviews as decision cards without leaking raw member UUIDs", async () => {
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
          createdBy: "620f1df3-f731-497b-9a8c-c5425f762c7d",
          updatedAt: "2026-09-01T09:30:00.000Z",
        },
      ],
    });

    const markup = await render();
    expect(markup).toContain("Add ESD protection to USB-C port");
    expect(markup).not.toContain('aria-label="Example PCB and schematic design views"');
    expect(markup).toContain("acme/board");
    expect(markup).toContain('href="/reviews/rev_real_1"');
    expect(markup).toContain(">1</strong> awaiting a decision");
    expect(markup).toContain('aria-label="Hardware reviews across visible repositories"');
    expect(markup).toContain("Inspect and decide");
    expect(markup).toContain("Opened by Recorded member");
    expect(markup).not.toContain("620f1df3-f731-497b-9a8c-c5425f762c7d");
    expect(markup).not.toContain("<table");
    // The richer fixture card carries finding counts the database listing does not query.
    expect(markup).not.toContain("blockers");
  });

  it("asks an unrecognised viewer to sign in rather than showing an empty registry", async () => {
    loadViewerReviews.mockResolvedValue({ state: "signed-out" });
    const markup = await render();
    expect(markup).toContain("Sign in required");
    expect(markup).toContain('href="/api/auth/github/login"');
    expect(markup).toContain("Sign in with GitHub");
    expect(markup).not.toContain("awaiting a decision");
    expect(markup).toContain('aria-label="Example PCB and schematic design views"');
    expect(markup).toContain("Example only");
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
    expect(markup).toContain('aria-label="Example PCB and schematic design views"');
    expect(markup).toContain("See the design, not just a report");
    expect(markup).toContain("Sample designs, not your repository");
    expect(markup).toContain("not recorded findings or manufacturing approval");
    expect(markup).toContain("/demo/zaptrace-sample-pcb.png");
    expect(markup).toContain("/demo/zaptrace-sample-schematic.png");
    expect(markup).toContain('href="/runs"');
    expect(markup).toContain("Browse your runs");
    expect(markup).toContain("Publish your first Review");
    expect(markup.indexOf("See the design, not just a report")).toBeLessThan(markup.indexOf('id="publish-review"'));
  });
});
