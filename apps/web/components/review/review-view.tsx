"use client";

import type { FindingDisposition, ReviewDecision } from "@boardreadyops/contracts";
import { useState } from "react";
import type { DemoApproval, DemoChecklistItem, DemoComment, DemoReview } from "../../lib/demo-data.js";
import { ApprovalModal } from "./approval-modal.js";
import { ChangesTab } from "./changes-tab.js";
import { ChecklistApprovalsTab } from "./checklist-approvals-tab.js";
import { DiscussionTab } from "./discussion-tab.js";
import { EvidenceTab } from "./evidence-tab.js";
import { FindingsTab } from "./findings-tab.js";
import { OverviewTab } from "./overview-tab.js";
import { ReviewHeader } from "./review-header.js";

export type ReviewTabKey = "overview" | "changes" | "findings" | "discussion" | "checklist" | "evidence";

export function ReviewView({ initialReview }: { initialReview: DemoReview }) {
  const [review, setReview] = useState<DemoReview>(initialReview);
  const [activeTab, setActiveTab] = useState<ReviewTabKey>("overview");
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

  async function handleAddComment(comment: DemoComment) {
    if (submittingAction) return;
    setSubmittingAction("comment");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: comment.content,
          ...(comment.findingFingerprint ? { findingFingerprint: comment.findingFingerprint } : {}),
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
      const mapped: DemoComment = {
        id: saved.id,
        content: saved.content,
        authorId: saved.authorId,
        authorType: saved.authorType,
        status: saved.status === "stale" ? "outdated" : (saved.status ?? "open"),
        createdAt: saved.createdAt,
        ...(saved.findingFingerprint ? { findingFingerprint: saved.findingFingerprint } : {}),
      };
      setReview((prev) => ({
        ...prev,
        comments: [...prev.comments, mapped],
      }));
      setMutationSuccess("Comment posted.");
    } catch (err) {
      setMutationError(`Failed to post comment: ${err instanceof Error ? err.message : "Network error"}`);
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

      {mutationError && (
        <div className="alert-banner error" role="alert" style={{ margin: "var(--space-3) 0" }}>
          {mutationError}
        </div>
      )}

      {mutationSuccess && (
        <div className="alert-banner success" role="status" style={{ margin: "var(--space-3) 0" }}>
          ✓ {mutationSuccess}
        </div>
      )}

      <div className="review-workspace-nav review-tabs-navigation" aria-label="Review workspace" role="tablist">
        <button
          id="tab-overview"
          role="tab"
          aria-selected={activeTab === "overview"}
          aria-controls="panel-overview"
          type="button"
          className={`review-tab-link ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          id="tab-changes"
          role="tab"
          aria-selected={activeTab === "changes"}
          aria-controls="panel-changes"
          type="button"
          className={`review-tab-link ${activeTab === "changes" ? "active" : ""}`}
          onClick={() => setActiveTab("changes")}
        >
          Changes{review.changedFiles !== undefined ? ` (${review.changedFiles.length})` : ""}
        </button>
        <button
          id="tab-findings"
          role="tab"
          aria-selected={activeTab === "findings"}
          aria-controls="panel-findings"
          type="button"
          className={`review-tab-link ${activeTab === "findings" ? "active" : ""}`}
          onClick={() => setActiveTab("findings")}
        >
          Findings ({review.findings.length})
          {blockingCount > 0 ? <span className="tab-pill danger">{blockingCount}</span> : null}
        </button>
        <button
          id="tab-discussion"
          role="tab"
          aria-selected={activeTab === "discussion"}
          aria-controls="panel-discussion"
          type="button"
          className={`review-tab-link ${activeTab === "discussion" ? "active" : ""}`}
          onClick={() => setActiveTab("discussion")}
        >
          Discussion ({review.comments.length})
        </button>
        <button
          id="tab-checklist"
          role="tab"
          aria-selected={activeTab === "checklist"}
          aria-controls="panel-checklist"
          type="button"
          className={`review-tab-link ${activeTab === "checklist" ? "active" : ""}`}
          onClick={() => setActiveTab("checklist")}
        >
          Checklist & Approvals
          {incompleteChecklistCount > 0 ? <span className="tab-pill warning">{incompleteChecklistCount}</span> : null}
        </button>
        <button
          id="tab-evidence"
          role="tab"
          aria-selected={activeTab === "evidence"}
          aria-controls="panel-evidence"
          type="button"
          className={`review-tab-link ${activeTab === "evidence" ? "active" : ""}`}
          onClick={() => setActiveTab("evidence")}
        >
          Evidence
        </button>
      </div>

      <main id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="review-tab-body">
        {activeTab === "overview" ? <OverviewTab review={review} /> : null}
        {activeTab === "changes" ? <ChangesTab review={review} /> : null}
        {activeTab === "findings" ? (
          <FindingsTab
            findings={review.findings}
            onUpdateDisposition={handleUpdateDisposition}
            onAssign={handleAssign}
          />
        ) : null}
        {activeTab === "discussion" ? (
          <DiscussionTab comments={review.comments} onAddComment={handleAddComment} />
        ) : null}
        {activeTab === "checklist" ? (
          <ChecklistApprovalsTab
            checklist={review.checklist}
            approvals={review.approvals}
            evidenceDigest={review.evidenceDigest}
            onToggleChecklist={handleToggleChecklist}
            onAddChecklist={handleAddChecklist}
          />
        ) : null}
        {activeTab === "evidence" ? <EvidenceTab review={review} /> : null}
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
