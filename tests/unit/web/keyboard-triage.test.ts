import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChecklistApprovalsTab } from "../../../apps/web/components/review/checklist-approvals-tab.js";
import { DiscussionTab } from "../../../apps/web/components/review/discussion-tab.js";
import { FindingsTab } from "../../../apps/web/components/review/findings-tab.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("Interactive Review Components", () => {
  const review = DEMO_REVIEWS[0] as (typeof DEMO_REVIEWS)[0];

  it("renders FindingsTab with triage controls and shortcuts", () => {
    const markup = renderToStaticMarkup(
      createElement(FindingsTab, {
        findings: review.findings,
      }),
    );
    expect(markup).toContain("findings-triage-toolbar");
    expect(markup).toContain("kicad/track-clearance");
  });

  it("renders DiscussionTab with threaded review comments", () => {
    const markup = renderToStaticMarkup(
      createElement(DiscussionTab, {
        comments: review.comments,
      }),
    );
    expect(markup).toContain("Review Discussion");
    expect(markup).toContain("alex.kumar@acme.corp");
  });

  it("renders ChecklistApprovalsTab with progress bar and approvals ledger", () => {
    const markup = renderToStaticMarkup(
      createElement(ChecklistApprovalsTab, {
        checklist: review.checklist,
        approvals: review.approvals,
        evidenceDigest: review.evidenceDigest,
      }),
    );
    expect(markup).toContain("Hardware Verification Checklist");
    expect(markup).toContain("Formal Approvals");
  });
});
