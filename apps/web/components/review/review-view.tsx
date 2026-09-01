"use client";

import type { FindingDisposition, ReviewDecision } from "@boardreadyops/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import type { DemoApproval, DemoChecklistItem, DemoReview } from "../../lib/demo-data.js";
import { ApprovalModal } from "./approval-modal.js";
import { ChangesTab } from "./changes-tab.js";
import { ChecklistApprovalsTab } from "./checklist-approvals-tab.js";
import { DiscussionTab } from "./discussion-tab.js";
import { EvidenceTab } from "./evidence-tab.js";
import { FindingsTab } from "./findings-tab.js";
import { OverviewTab } from "./overview-tab.js";
import { ReviewHeader } from "./review-header.js";

export type ReviewTabKey = "overview" | "changes" | "findings" | "discussion" | "checklist" | "evidence";

const reviewTabKeys: readonly ReviewTabKey[] = [
  "overview",
  "changes",
  "findings",
  "discussion",
  "checklist",
  "evidence",
];

function tabFromSearchParam(value: string | null): ReviewTabKey {
  return (reviewTabKeys as readonly string[]).includes(value ?? "") ? (value as ReviewTabKey) : "overview";
}

interface ReviewNavigationTabsProps {
  readonly activeTab: ReviewTabKey;
  readonly changedFilesCount?: number | undefined;
  readonly findingsCount: number;
  readonly blockingCount: number;
  readonly commentsCount: number;
  readonly incompleteChecklistCount: number;
  readonly onSelectTab: (tab: ReviewTabKey) => void;
}

function ReviewNavigationTabs({
  activeTab,
  changedFilesCount,
  findingsCount,
  blockingCount,
  commentsCount,
  incompleteChecklistCount,
  onSelectTab,
}: ReviewNavigationTabsProps) {
  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, currentTab: ReviewTabKey) {
    const currentIndex = reviewTabKeys.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % reviewTabKeys.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + reviewTabKeys.length) % reviewTabKeys.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = reviewTabKeys.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextTab = reviewTabKeys[nextIndex];
    if (!nextTab) return;
    onSelectTab(nextTab);
    document.getElementById(`tab-${nextTab}`)?.focus();
  }

  return (
    <div className="review-workspace-nav review-tabs-navigation" aria-label="Review workspace" role="tablist">
      <button
        id="tab-overview"
        role="tab"
        aria-selected={activeTab === "overview"}
        aria-controls="panel-overview"
        tabIndex={activeTab === "overview" ? 0 : -1}
        type="button"
        className={`review-tab-link ${activeTab === "overview" ? "active" : ""}`}
        onClick={() => onSelectTab("overview")}
        onKeyDown={(e) => handleTabKeyDown(e, "overview")}
      >
        Overview
      </button>
      <button
        id="tab-changes"
        role="tab"
        aria-selected={activeTab === "changes"}
        aria-controls="panel-changes"
        tabIndex={activeTab === "changes" ? 0 : -1}
        type="button"
        className={`review-tab-link ${activeTab === "changes" ? "active" : ""}`}
        onClick={() => onSelectTab("changes")}
        onKeyDown={(e) => handleTabKeyDown(e, "changes")}
      >
        Changes{changedFilesCount !== undefined ? ` (${changedFilesCount})` : ""}
      </button>
      <button
        id="tab-findings"
        role="tab"
        aria-selected={activeTab === "findings"}
        aria-controls="panel-findings"
        tabIndex={activeTab === "findings" ? 0 : -1}
        type="button"
        className={`review-tab-link ${activeTab === "findings" ? "active" : ""}`}
        onClick={() => onSelectTab("findings")}
        onKeyDown={(e) => handleTabKeyDown(e, "findings")}
      >
        Findings ({findingsCount})
        {blockingCount > 0 ? (
          <span className="tab-pill danger" aria-hidden="true">
            {blockingCount}
          </span>
        ) : null}
        {blockingCount > 0 ? <span className="sr-only">, {blockingCount} blocking</span> : null}
      </button>
      <button
        id="tab-discussion"
        role="tab"
        aria-selected={activeTab === "discussion"}
        aria-controls="panel-discussion"
        tabIndex={activeTab === "discussion" ? 0 : -1}
        type="button"
        className={`review-tab-link ${activeTab === "discussion" ? "active" : ""}`}
        onClick={() => onSelectTab("discussion")}
        onKeyDown={(e) => handleTabKeyDown(e, "discussion")}
      >
        Discussion ({commentsCount})
      </button>
      <button
        id="tab-checklist"
        role="tab"
        aria-selected={activeTab === "checklist"}
        aria-controls="panel-checklist"
        tabIndex={activeTab === "checklist" ? 0 : -1}
        type="button"
        className={`review-tab-link ${activeTab === "checklist" ? "active" : ""}`}
        onClick={() => onSelectTab("checklist")}
        onKeyDown={(e) => handleTabKeyDown(e, "checklist")}
      >
        Checklist & Approvals
        {incompleteChecklistCount > 0 ? (
          <span className="tab-pill warning" aria-hidden="true">
            {incompleteChecklistCount}
          </span>
        ) : null}
        {incompleteChecklistCount > 0 ? <span className="sr-only">, {incompleteChecklistCount} incomplete</span> : null}
      </button>
      <button
        id="tab-evidence"
        role="tab"
        aria-selected={activeTab === "evidence"}
        aria-controls="panel-evidence"
        tabIndex={activeTab === "evidence" ? 0 : -1}
        type="button"
        className={`review-tab-link ${activeTab === "evidence" ? "active" : ""}`}
        onClick={() => onSelectTab("evidence")}
        onKeyDown={(e) => handleTabKeyDown(e, "evidence")}
      >
        Evidence
      </button>
    </div>
  );
}

export function ReviewView({
  initialReview,
  viewerLogin,
}: {
  readonly initialReview: DemoReview;
  readonly viewerLogin?: string | undefined;
}) {
  const [review, setReview] = useState<DemoReview>(initialReview);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rawActiveTab, setRawActiveTab] = useState<ReviewTabKey>(() => tabFromSearchParam(searchParams.get("tab")));

  // The URL is the single source of truth for which tab is open: this keeps
  // browser Back/Forward and a shared/reloaded ?tab= link in sync with what
  // renders, instead of a separate state that can drift from it.
  useEffect(() => {
    setRawActiveTab(tabFromSearchParam(searchParams.get("tab")));
  }, [searchParams]);

  function setActiveTab(tab: ReviewTabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  const [approvalModalType, setApprovalModalType] = useState<"approve" | "request_changes" | null>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  const blockingCount = review.findings.filter(
    (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
  ).length;

  const incompleteChecklistCount = review.checklist.filter((c) => !c.completed).length;

  async function handleUpdateDisposition(
    fingerprint: string,
    disposition: FindingDisposition,
    reason?: string,
    owner?: string,
    expiresAt?: string | null,
  ) {
    if (submittingAction) return;
    setSubmittingAction(`disposition_${fingerprint}`);
    setMutationError(null);
    setMutationSuccess(null);
    const effectiveReason =
      reason?.trim() ||
      (disposition === "accepted_risk"
        ? "Risk accepted by lead engineering sign-off review."
        : `Disposition set to ${disposition}`);
    const effectiveOwner = owner?.trim() || "reviewer";

    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingFingerprint: fingerprint,
          disposition,
          reason: effectiveReason,
          owner: effectiveOwner,
          expiresAt: expiresAt ?? null,
          evidenceDigest: review.evidenceDigest,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMutationError(`Failed to update disposition: ${data.error || res.statusText}`);
        return;
      }
      setReview((prev) => ({
        ...prev,
        findings: prev.findings.map((f) =>
          f.fingerprint === fingerprint
            ? {
                ...f,
                disposition,
                decisionReason: reason,
                decisionOwner: owner,
                decisionExpiresAt: expiresAt,
              }
            : f,
        ),
      }));
      setMutationSuccess("Finding decision recorded.");
    } catch (err) {
      setMutationError(`Failed to record decision: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleAssign(fingerprint: string, assignee: string) {
    if (submittingAction) return;
    setSubmittingAction(`assign_${fingerprint}`);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingFingerprint: fingerprint,
          assignee,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMutationError(`Failed to assign finding: ${data.error || res.statusText}`);
        return;
      }
      setReview((prev) => ({
        ...prev,
        findings: prev.findings.map((f) =>
          f.fingerprint === fingerprint
            ? { ...f, assignees: f.assignees.includes(assignee) ? f.assignees : [...f.assignees, assignee] }
            : f,
        ),
      }));
      setMutationSuccess(`Assigned finding to ${assignee}.`);
    } catch (err) {
      setMutationError(`Failed to assign finding: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleAddComment(content: string, findingFingerprint?: string) {
    if (submittingAction) return;
    setSubmittingAction("comment");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          ...(findingFingerprint ? { findingFingerprint } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        comment?: {
          id: string;
          content: string;
          authorId: string;
          authorType: "internal" | "guest";
          status?: "open" | "resolved" | "stale";
          createdAt: string;
          findingFingerprint?: string;
        };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.comment) {
        setMutationError(`Failed to post comment: ${data.error || res.statusText}`);
        return;
      }
      const saved = data.comment;
      setReview((prev) => ({
        ...prev,
        comments: [
          ...prev.comments,
          {
            id: saved.id,
            content: saved.content,
            authorId: saved.authorId,
            authorType: saved.authorType,
            status: saved.status === "stale" ? "outdated" : (saved.status ?? "open"),
            createdAt: saved.createdAt,
            ...(saved.findingFingerprint ? { findingFingerprint: saved.findingFingerprint } : {}),
          },
        ],
      }));
      setMutationSuccess("Comment posted.");
    } catch (err) {
      setMutationError(`Failed to post comment: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleToggleCommentStatus(commentId: string, nextStatus: "open" | "resolved") {
    if (submittingAction) return;
    setSubmittingAction(`comment_status_${commentId}`);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/comments`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId, status: nextStatus }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        comment?: { id: string; status: "open" | "resolved" | "stale" };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.comment) {
        setMutationError(`Failed to update comment: ${data.error || res.statusText}`);
        return;
      }
      const saved = data.comment;
      setReview((prev) => ({
        ...prev,
        comments: prev.comments.map((c) =>
          c.id === commentId ? { ...c, status: saved.status === "stale" ? "outdated" : saved.status } : c,
        ),
      }));
    } catch (err) {
      setMutationError(`Failed to update comment: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleToggleChecklist(id: string, completed: boolean) {
    if (submittingAction) return;
    setSubmittingAction(`chk_toggle_${id}`);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/checklist`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          completed,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        item?: { id: string; title: string; completed: boolean; completedBy?: string; completedAt?: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.item) {
        setMutationError(`Failed to update checklist item: ${data.error || res.statusText}`);
        return;
      }
      const saved = data.item;
      setReview((prev) => ({
        ...prev,
        checklist: prev.checklist.map((c) =>
          c.id === id
            ? {
                id: saved.id,
                title: saved.title,
                completed: saved.completed,
                completedBy: saved.completedBy,
                completedAt: saved.completedAt,
              }
            : c,
        ),
      }));
    } catch (err) {
      setMutationError(`Failed to update checklist: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleAddChecklist(title: string) {
    if (submittingAction) return;
    setSubmittingAction("chk_add");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/checklist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        item?: { id: string; title: string; completed: boolean; completedBy?: string; completedAt?: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.item) {
        setMutationError(`Failed to add checklist item: ${data.error || res.statusText}`);
        return;
      }
      const saved = data.item;
      const newItem: DemoChecklistItem = {
        id: saved.id,
        title: saved.title,
        completed: saved.completed,
        completedBy: saved.completedBy,
        completedAt: saved.completedAt,
      };
      setReview((prev) => ({
        ...prev,
        checklist: [...prev.checklist, newItem],
      }));
      setMutationSuccess("Checklist item added.");
    } catch (err) {
      setMutationError(`Failed to add checklist item: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleApprovalConfirm(data: { reason: string; isBreakGlass?: boolean }) {
    if (!approvalModalType || submittingAction) return;

    const isApprove = approvalModalType === "approve";
    const status = isApprove ? "approved" : "changes_requested";
    const reason = data.reason.trim() || (isApprove ? "Approved" : "Changes requested");
    const isBreakGlass = data.isBreakGlass ?? false;

    setSubmittingAction(approvalModalType);
    setMutationError(null);
    setMutationSuccess(null);

    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revisionId: review.currentRevisionId,
          evidenceDigest: review.evidenceDigest,
          status,
          reason,
          isBreakGlass,
        }),
      });

      const body = (await res.json()) as { ok: boolean; approval?: DemoApproval; error?: string };

      if (!res.ok || !body.ok || !body.approval) {
        const errorMsg = body.error || `Server returned status ${res.status}`;
        setMutationError(`Failed to persist sign-off: ${errorMsg}`);
        return;
      }

      const authoritativeApproval = body.approval;
      const nextDecision: ReviewDecision = isApprove ? "approved" : "changes_requested";

      setReview((prev) => {
        const existing = prev.approvals.some((a) => a.id === authoritativeApproval.id);
        const nextApprovals = existing ? prev.approvals : [authoritativeApproval, ...prev.approvals];
        return {
          ...prev,
          decision: nextDecision,
          approvals: nextApprovals,
          updatedAt: authoritativeApproval.createdAt ?? new Date().toISOString(),
        };
      });

      setMutationSuccess(
        isApprove
          ? "Review approval recorded against the current evidence digest."
          : "Changes requested on hardware review.",
      );
      setApprovalModalType(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Network error";
      setMutationError(`Failed to persist sign-off: ${errorMsg}`);
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <div className="review-view-container">
      <ReviewHeader
        reviewId={review.id}
        title={review.title}
        repositoryName={review.repositoryName}
        pullRequestNumber={review.pullRequestNumber}
        status={review.status}
        decision={review.decision}
        currentRevisionSequence={review.currentRevisionSequence}
        baseCommitSha={review.baseCommitSha}
        headCommitSha={review.headCommitSha}
        evidenceDigest={review.evidenceDigest}
        evidenceState={review.evidenceState}
        onApprove={() => setApprovalModalType("approve")}
        onRequestChanges={() => setApprovalModalType("request_changes")}
      />

      {mutationError ? (
        <div className="alert-banner error" role="alert" style={{ margin: "var(--space-3) 0" }}>
          {mutationError}
        </div>
      ) : null}

      {mutationSuccess ? (
        <output className="alert-banner success" style={{ margin: "var(--space-3) 0" }}>
          ✓ {mutationSuccess}
        </output>
      ) : null}

      <ReviewNavigationTabs
        activeTab={rawActiveTab}
        changedFilesCount={review.changedFiles?.length}
        findingsCount={review.findings.length}
        blockingCount={blockingCount}
        commentsCount={review.comments.length}
        incompleteChecklistCount={incompleteChecklistCount}
        onSelectTab={setActiveTab}
      />

      <main
        id={`panel-${rawActiveTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${rawActiveTab}`}
        className="review-tab-body"
      >
        {rawActiveTab === "overview" ? <OverviewTab review={review} /> : null}
        {rawActiveTab === "changes" ? <ChangesTab review={review} /> : null}
        {rawActiveTab === "findings" ? (
          <FindingsTab
            findings={review.findings}
            onUpdateDisposition={handleUpdateDisposition}
            onAssign={handleAssign}
          />
        ) : null}
        {rawActiveTab === "discussion" ? (
          <DiscussionTab
            comments={review.comments}
            viewerLogin={viewerLogin}
            onAddComment={handleAddComment}
            onToggleStatus={handleToggleCommentStatus}
          />
        ) : null}
        {rawActiveTab === "checklist" ? (
          <ChecklistApprovalsTab
            checklist={review.checklist}
            approvals={review.approvals}
            evidenceDigest={review.evidenceDigest}
            onToggleChecklist={handleToggleChecklist}
            onAddChecklist={handleAddChecklist}
          />
        ) : null}
        {rawActiveTab === "evidence" ? <EvidenceTab review={review} /> : null}
      </main>

      {approvalModalType ? (
        <ApprovalModal
          type={approvalModalType}
          evidenceDigest={review.evidenceDigest}
          isSubmitting={submittingAction !== null}
          serverError={mutationError}
          onConfirm={handleApprovalConfirm}
          onClose={() => {
            if (!submittingAction) {
              setApprovalModalType(null);
              setMutationError(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
