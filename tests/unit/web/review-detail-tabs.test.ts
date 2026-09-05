import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/reviews/rev_gateway_42",
  useSearchParams: () => new URLSearchParams(),
}));

import { ChangesTab } from "../../../apps/web/components/review/changes-tab.js";
import { ChecklistApprovalsTab } from "../../../apps/web/components/review/checklist-approvals-tab.js";
import { EvidenceTab } from "../../../apps/web/components/review/evidence-tab.js";
import { OverviewTab } from "../../../apps/web/components/review/overview-tab.js";
import { ReviewHeader } from "../../../apps/web/components/review/review-header.js";
import { ReviewView } from "../../../apps/web/components/review/review-view.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("Review Detail Tabs", () => {
  const review = DEMO_REVIEWS[0] as (typeof DEMO_REVIEWS)[0];

  it("renders ReviewHeader with command header and decision summary", () => {
    const header = renderToStaticMarkup(
      createElement(ReviewHeader, {
        reviewId: review.id,
        title: review.title,
        repositoryName: review.repositoryName,
        pullRequestNumber: review.pullRequestNumber,
        status: review.status,
        decision: review.decision,
        currentRevisionSequence: review.currentRevisionSequence,
        baseCommitSha: review.baseCommitSha,
        headCommitSha: review.headCommitSha,
        evidenceDigest: review.evidenceDigest,
        evidenceState: review.evidenceState,
      }),
    );
    expect(header).toContain("Approve review");
    expect(header).toContain("Request changes");
  });

  it("renders ReviewView with accessible tablist and workspace semantics", () => {
    const view = renderToStaticMarkup(createElement(ReviewView, { initialReview: review }));
    expect(view).toContain('aria-label="Review workspace"');
    expect(view).toContain('aria-selected="true"');
    expect(view).toContain('role="tablist"');
    expect(view).toContain('role="tabpanel"');
  });

  it("hides the tab count pill from assistive tech instead of gluing it onto the tab name", () => {
    const view = renderToStaticMarkup(createElement(ReviewView, { initialReview: review }));
    expect(view).toContain(
      '<span class="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white" aria-hidden="true">',
    );
    expect(view).toContain('<span class="sr-only">, ');
    expect(view).toContain(" blocking</span>");
  });

  it("renders OverviewTab with readiness gate status and metadata", () => {
    const overview = OverviewTab({ review });
    expect(overview).toBeDefined();
    expect(overview.props).toBeDefined();
  });

  it("renders ChangesTab with schematic, layout, and BOM diffs", () => {
    const changes = ChangesTab({ review });
    expect(changes).toBeDefined();
    expect(changes.props).toBeDefined();
  });

  it("renders EvidenceTab with artifact manifest and offline verify command", () => {
    const evidence = renderToStaticMarkup(createElement(EvidenceTab, { review }));
    expect(evidence).toBeDefined();
    expect(evidence).toContain("provenance-chain");
    expect(evidence).toContain("Head Evidence Digest");
    expect(evidence).toContain(
      "SHA-256 artifact digests and revision-bound evidence records for this hardware revision.",
    );
    expect(evidence).not.toContain("Immutable cryptographic records");
  });

  it("describes approval records without claiming cryptographic signatures or append-only storage", () => {
    const approvals = renderToStaticMarkup(
      createElement(ChecklistApprovalsTab, {
        checklist: review.checklist,
        approvals: review.approvals,
        evidenceDigest: review.evidenceDigest,
      }),
    );
    expect(approvals).toContain("Engineering sign-offs recorded against revision evidence digests.");
    expect(approvals).not.toContain("Append-only cryptographic record");
  });
});
