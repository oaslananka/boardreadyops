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
import { OverviewTab, ReviewRevisionEvidence } from "../../../apps/web/components/review/overview-tab.js";
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

  it("keeps the mobile Review summary compact without hiding signoff or evidence-copy actions", () => {
    const html = renderToStaticMarkup(
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
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("sm:line-clamp-none");
    expect(html).toContain("overflow-hidden whitespace-nowrap");
    expect(html).toContain("Review actions &amp; evidence");
    expect(html).toContain('<details class="group rounded-md border border-border/70 bg-background/30 sm:hidden">');
    expect(html).toContain("Copy digest");
    expect(html).toContain('role="img" aria-label="Evidence is current"');
    expect(html).toContain("Approve review");
    expect(html).toContain("Request changes");
    const stale = renderToStaticMarkup(
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
        evidenceState: "stale",
      }),
    );
    expect(stale).toContain('role="img" aria-label="Evidence is stale"');
  });

  it("keeps all Review tabs keyboard accessible on a single mobile scroll row", () => {
    const html = renderToStaticMarkup(createElement(ReviewView, { initialReview: review }));
    expect(html).toContain("min-w-0 flex-nowrap gap-1 overflow-x-auto border-b");
    expect(html).toContain('id="tab-changes" role="tab"');
    expect(html).toContain('id="tab-evidence" role="tab"');
    expect(html).toContain("min-h-11 shrink-0 items-center");
  });

  it("labels a manual Review without inventing a PR number or base commit", () => {
    const manual = { ...review, pullRequestNumber: 0, baseCommitSha: "0".repeat(40) };
    const header = renderToStaticMarkup(
      createElement(ReviewHeader, {
        reviewId: manual.id,
        title: manual.title,
        repositoryName: manual.repositoryName,
        pullRequestNumber: manual.pullRequestNumber,
        status: manual.status,
        decision: manual.decision,
        currentRevisionSequence: manual.currentRevisionSequence,
        baseCommitSha: manual.baseCommitSha,
        headCommitSha: manual.headCommitSha,
        evidenceDigest: manual.evidenceDigest,
        evidenceState: manual.evidenceState,
      }),
    );
    expect(header).toContain("Manual review");
    expect(header).toContain("No base");
    expect(header).not.toContain("PR #0");
    expect(header).not.toContain("0000000");
    const overview = renderToStaticMarkup(createElement(OverviewTab, { review: manual }));
    expect(overview).toContain("Not recorded");
    expect(overview).not.toContain("Open the visual diff");
  });

  it("shows authorized persisted Review revision run links, but no invented fixture source run", () => {
    const persisted = renderToStaticMarkup(
      createElement(ReviewView, {
        initialReview: { ...review, headRunId: "head-run-42", baseRunId: "base-run-41" },
      }),
    );
    expect(persisted).toContain('href="/runs/head-run-42"');
    expect(persisted).toContain('href="/runs/base-run-41"');
    expect(persisted).toContain('aria-label="Review source runs"');

    const fixture = renderToStaticMarkup(createElement(ReviewView, { initialReview: review }));
    expect(fixture).not.toContain('aria-label="Review source runs"');
  });

  it("shows source-bound PCB preview before technical review details when snapshots exist", () => {
    const overview = renderToStaticMarkup(createElement(OverviewTab, { review, onOpenChanges: () => undefined }));
    if ((review.headSnapshots?.length ?? 0) > 0) {
      expect(overview).toContain('aria-label="Published design preview"');
      expect(overview.indexOf("Explore this board revision")).toBeLessThan(overview.indexOf("Review Checks"));
      expect(overview).toContain("not a manufacturing approval");
      expect(overview).toContain("Inspect findings on the board");
    }
    const withoutImages = renderToStaticMarkup(
      createElement(OverviewTab, { review: { ...review, headSnapshots: undefined }, onOpenChanges: () => undefined }),
    );
    expect(withoutImages).not.toContain('aria-label="Published design preview"');
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

  it("shows an exact source comparison only for linked evidence runs, never board-level signoff", () => {
    const linked = renderToStaticMarkup(
      createElement(ReviewRevisionEvidence, {
        review: {
          ...review,
          baseCommitSha: "a".repeat(40),
          headCommitSha: "b".repeat(40),
          baseRunId: "base-run/41",
          headRunId: "head-run/42",
        },
      }),
    );
    expect(linked).toContain('href="/runs/base-run%2F41"');
    expect(linked).toContain('href="/runs/head-run%2F42"');
    expect(linked).toContain("a".repeat(40));
    expect(linked).toContain("b".repeat(40));
    expect(linked).toContain("repository-scoped");
    expect(linked).toContain("neither a Run link nor this comparison proves which individual boards were approved");

    const notLinked = renderToStaticMarkup(
      createElement(ReviewRevisionEvidence, {
        review: { ...review, baseRunId: undefined, headRunId: undefined, baseCommitSha: "0".repeat(40) },
      }),
    );
    expect(notLinked).toContain("Not recorded");
    expect(notLinked).toContain("No linked base Run");
    expect(notLinked).toContain("No linked head Run");
    expect(notLinked).not.toContain('href="/runs/');
  });

  it("never treats an approved review as signed manufacturing authorization", () => {
    const approved = {
      ...review,
      decision: "approved" as const,
      evidenceState: "current" as const,
      findings: review.findings.map((finding) => ({ ...finding, disposition: "fixed" as const })),
      checklist: review.checklist.map((item) => ({ ...item, completed: true })),
      approvals: [
        {
          id: "approved-for-current-evidence",
          approverId: "reviewer@example.test",
          status: "approved" as const,
          evidenceDigest: review.evidenceDigest,
          createdAt: "2026-10-11T00:00:00Z",
        },
      ],
    };
    const completedMarkup = renderToStaticMarkup(createElement(OverviewTab, { review: approved }));
    expect(completedMarkup).toContain("Review Checks Met");
    expect(completedMarkup).toContain("Release Not Verified");
    expect(completedMarkup).toContain("not a verified manufacturing export");
    expect(completedMarkup).not.toContain("Ready for Fabrication");
    const stale = renderToStaticMarkup(
      createElement(OverviewTab, { review: { ...approved, evidenceState: "stale" as const } }),
    );
    expect(stale).toContain("Review Checks Incomplete");
    expect(stale).not.toContain("Review Checks Met");
    const requested = renderToStaticMarkup(
      createElement(OverviewTab, { review: { ...approved, decision: "changes_requested" as const } }),
    );
    expect(requested).toContain("Changes Requested — Review Blocked");
  });

  it("renders OverviewTab with readiness gate status and metadata", () => {
    const overview = OverviewTab({ review });
    expect(overview).toBeDefined();
    expect(overview.props).toBeDefined();
  });
  it("renders effective policy inheritance with field-level provenance", () => {
    const policyReview = {
      ...review,
      effectivePolicy: {
        id: "rpol-org",
        name: "Org baseline",
        sourceLayer: "repository" as const,
        requiredChecklist: ["fab-checklist"],
        requiredRoles: ["hardware-lead"],
        severityGate: "high" as const,
        requireEvidencePack: true,
        requireExternalReview: true,
        provenance: {
          requiredChecklist: { layer: "repository" as const, policyId: "rpol-repo", policyName: "Repo override" },
          requiredRoles: { layer: "organization" as const, policyId: "rpol-org", policyName: "Org baseline" },
          severityGate: { layer: "organization" as const, policyId: "rpol-org", policyName: "Org baseline" },
          requireEvidencePack: { layer: "organization" as const, policyId: "rpol-org", policyName: "Org baseline" },
          requireExternalReview: {
            layer: "repository" as const,
            policyId: "rpol-repo",
            policyName: "Repo override",
          },
        },
      },
    };

    const overview = renderToStaticMarkup(createElement(OverviewTab, { review: policyReview }));

    expect(overview).not.toContain("Effective Policy &amp; Inheritance");
    expect(overview).toContain("Current configured policy (not a run snapshot)");
    expect(overview).toContain("resolved from the current organization and repository settings");
    expect(overview).toContain("not historical evidence of the policy used for this review revision");

    expect(overview).toContain("Org baseline");
    expect(overview).toContain("Repository · Repo override");
    expect(overview).toContain("Organization · Org baseline");
    expect(overview).toContain("fab-checklist");
    expect(overview).toContain("hardware-lead");
  });

  it("renders ChangesTab with schematic, layout, and BOM diffs", () => {
    const changes = ChangesTab({ review });
    expect(changes).toBeDefined();
    expect(changes.props).toBeDefined();
  });

  it("renders EvidenceTab with artifact manifest and offline verify command", () => {
    const evidence = renderToStaticMarkup(createElement(EvidenceTab, { review }));
    expect(evidence).toBeDefined();
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
