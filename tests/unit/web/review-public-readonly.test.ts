import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/reviews/rev_gateway_42",
  useSearchParams: () => new URLSearchParams(),
}));

import { ChecklistApprovalsTab } from "../../../apps/web/components/review/checklist-approvals-tab.js";
import { DiscussionTab } from "../../../apps/web/components/review/discussion-tab.js";
import { FindingsTab } from "../../../apps/web/components/review/findings-tab.js";
import { ReviewView } from "../../../apps/web/components/review/review-view.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const review = DEMO_REVIEWS[0];
if (!review) throw new Error("Expected demo review");

describe("public review read-only presentation", () => {
  it("keeps public evidence navigable but gives a signed-out viewer no signoff controls", () => {
    const html = renderToStaticMarkup(createElement(ReviewView, { initialReview: review, readOnly: true }));
    expect(html).toContain("Read-only review.");
    expect(html).toContain("Sign in to manage an authorized review");
    expect(html).toContain("Changes");
    expect(html).not.toContain("Approve review");
    expect(html).not.toContain("Request changes");
  });

  it("does not suggest sign-in will override another installation's access", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewView, { initialReview: review, readOnly: true, viewerLogin: "unrelated-user" }),
    );
    expect(html).toContain("Read-only review.");
    expect(html).not.toContain("Sign in to manage an authorized review");
    expect(html).not.toContain("Approve review");
  });

  it("renders finding status and assignee as evidence without editable triage controls", () => {
    const html = renderToStaticMarkup(
      createElement(FindingsTab, {
        findings: review.findings,
        readOnly: true,
        onUpdateDisposition: vi.fn(),
        onAssign: vi.fn(),
      }),
    );
    expect(html).toContain("Search findings");
    expect(html).toContain("Assignee:");
    expect(html).not.toContain("Disposition for finding");
    expect(html).not.toContain("Add assignee for finding");
    expect(html).not.toContain("assignee-add-btn");
    expect(html).not.toContain("accept risk");
    expect(html).not.toContain("false positive");
  });

  it("shows discussion and approvals without write actions for public readers", () => {
    const discussion = renderToStaticMarkup(
      createElement(DiscussionTab, {
        comments: review.comments,
        readOnly: true,
        onAddComment: vi.fn(),
        onToggleStatus: vi.fn(),
      }),
    );
    expect(discussion).toContain("Review Discussion");
    expect(discussion).not.toContain("Post Comment");
    expect(discussion).not.toContain("Mark Resolved");
    expect(discussion).not.toContain("Add to Discussion");

    const checklist = renderToStaticMarkup(
      createElement(ChecklistApprovalsTab, {
        checklist: review.checklist,
        approvals: review.approvals,
        evidenceDigest: review.evidenceDigest,
        readOnly: true,
        onToggleChecklist: vi.fn(),
        onAddChecklist: vi.fn(),
      }),
    );
    expect(checklist).toContain("Hardware Verification Checklist");
    expect(checklist).not.toContain("Add custom verification check");
    expect(checklist).not.toContain("+ Add Check");
    expect(checklist).toContain("disabled");
  });

  it("preserves existing authorized review controls", () => {
    const html = renderToStaticMarkup(createElement(ReviewView, { initialReview: review }));
    expect(html).toContain("Approve review");
    expect(html).toContain("Request changes");
    expect(html).not.toContain("Read-only review.");
  });
});
