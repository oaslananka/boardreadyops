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

const loadViewerWorkQueue = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/work-queue.js", () => ({ loadViewerWorkQueue }));

const { default: MyWorkPage } = await import("../../../apps/web/app/work/page.js");
const { DEMO_REVIEWS } = await import("../../../apps/web/lib/demo-data.js");

async function render(): Promise<string> {
  return renderToStaticMarkup(await MyWorkPage());
}

describe("MyWorkPage", () => {
  it("renders assigned findings, awaiting-review, and changes-requested sections from fixtures", async () => {
    loadViewerReviews.mockResolvedValue({ state: "fixtures", reviews: DEMO_REVIEWS });
    const markup = await render();

    expect(markup).toContain("Assigned Findings");
    expect(markup).toContain("Awaiting Your Review");

    const assigned = DEMO_REVIEWS.flatMap((r) =>
      r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open"),
    );
    expect(assigned.length).toBeGreaterThan(0);
    expect(markup).toContain(assigned[0]?.message);
  });

  it("reads the real queue once the listing comes from the database", async () => {
    loadViewerReviews.mockResolvedValue({
      state: "ok",
      next: undefined,
      reviews: [
        {
          id: "rev_real_1",
          repositoryId: "repo_1",
          repositoryName: "acme/board",
          pullRequestNumber: 7,
          title: "Add ESD protection",
          status: "active",
          decision: "pending",
          createdBy: "dana@acme.corp",
          updatedAt: "2026-09-01T09:30:00.000Z",
        },
      ],
    });
    loadViewerWorkQueue.mockResolvedValue({
      assignedFindings: [
        {
          fingerprint: "fp_1",
          ruleId: "drc.clearance",
          severity: "error",
          message: "Clearance below process minimum",
          path: "hardware/board.kicad_pcb",
          repositoryId: "repo_1",
          reviewId: "rev_real_1",
        },
      ],
    });

    const markup = await render();
    expect(markup).toContain("Clearance below process minimum");
    // The finding resolves its repository label through the listing rather than showing a raw id.
    expect(markup).toContain("acme/board");
    expect(markup).toContain("PR #7");
    expect(markup).toContain('href="/reviews/rev_real_1?tab=findings"');
  });

  it("asks an unrecognised viewer to sign in rather than showing an empty queue", async () => {
    loadViewerReviews.mockResolvedValue({ state: "signed-out" });
    const markup = await render();
    expect(markup).toContain("Sign in required");
    expect(markup).not.toContain("Assigned Findings");
  });
});
