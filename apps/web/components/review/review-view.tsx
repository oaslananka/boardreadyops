"use client";

import type { FindingDisposition } from "@boardreadyops/contracts";
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

  const blockingCount = review.findings.filter(
    (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
  ).length;

  const incompleteChecklistCount = review.checklist.filter((c) => !c.completed).length;

  function handleUpdateDisposition(
    fingerprint: string,
    disposition: FindingDisposition,
    reason?: string,
    owner?: string,
  ) {
    setReview((prev) => ({
      ...prev,
      findings: prev.findings.map((f) =>
        f.fingerprint === fingerprint
          ? {
              ...f,
              disposition,
              ...(reason ? { decisionReason: reason } : {}),
              ...(owner ? { decisionOwner: owner } : {}),
            }
          : f,
      ),
    }));
  }

  function handleAddComment(comment: DemoComment) {
    setReview((prev) => ({
      ...prev,
      comments: [...prev.comments, comment],
    }));
  }

  function handleToggleChecklist(id: string, completed: boolean) {
    setReview((prev) => ({
      ...prev,
      checklist: prev.checklist.map((c) =>
        c.id === id
          ? {
              id: c.id,
              title: c.title,
              completed,
              ...(completed ? { completedBy: "current.user@company.com", completedAt: new Date().toISOString() } : {}),
            }
          : c,
      ),
    }));
  }

  function handleAddChecklist(title: string) {
    const newItem: DemoChecklistItem = {
      id: `chk_${Date.now()}`,
      title,
      completed: false,
    };
    setReview((prev) => ({
      ...prev,
      checklist: [...prev.checklist, newItem],
    }));
  }

  function handleApprovalConfirm(data: { reason: string; isBreakGlass?: boolean }) {
    if (!approvalModalType) return;

    if (approvalModalType === "approve") {
      const newApproval: DemoApproval = {
        id: `app_${Date.now()}`,
        approverId: "current.user@company.com",
        status: "approved",
        reason: data.reason || "Approved",
        isBreakGlass: data.isBreakGlass ?? false,
        evidenceDigest: review.evidenceDigest,
        createdAt: new Date().toISOString(),
      };

      setReview((prev) => ({
        ...prev,
        decision: "approved",
        approvals: [newApproval, ...prev.approvals],
      }));
    } else {
      const newReq: DemoApproval = {
        id: `app_${Date.now()}`,
        approverId: "current.user@company.com",
        status: "changes_requested",
        reason: data.reason,
        evidenceDigest: review.evidenceDigest,
        createdAt: new Date().toISOString(),
      };

      setReview((prev) => ({
        ...prev,
        decision: "changes_requested",
        approvals: [newReq, ...prev.approvals],
      }));
    }

    setApprovalModalType(null);
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

      <nav className="review-tabs-navigation" aria-label="Review Sections">
        <button
          type="button"
          className={`review-tab-link ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`review-tab-link ${activeTab === "changes" ? "active" : ""}`}
          onClick={() => setActiveTab("changes")}
        >
          Changes ({review.changedFiles.length})
        </button>
        <button
          type="button"
          className={`review-tab-link ${activeTab === "findings" ? "active" : ""}`}
          onClick={() => setActiveTab("findings")}
        >
          Findings ({review.findings.length})
          {blockingCount > 0 ? <span className="tab-pill danger">{blockingCount}</span> : null}
        </button>
        <button
          type="button"
          className={`review-tab-link ${activeTab === "discussion" ? "active" : ""}`}
          onClick={() => setActiveTab("discussion")}
        >
          Discussion ({review.comments.length})
        </button>
        <button
          type="button"
          className={`review-tab-link ${activeTab === "checklist" ? "active" : ""}`}
          onClick={() => setActiveTab("checklist")}
        >
          Checklist & Approvals
          {incompleteChecklistCount > 0 ? <span className="tab-pill warning">{incompleteChecklistCount}</span> : null}
        </button>
        <button
          type="button"
          className={`review-tab-link ${activeTab === "evidence" ? "active" : ""}`}
          onClick={() => setActiveTab("evidence")}
        >
          Evidence
        </button>
      </nav>

      <main className="review-tab-body">
        {activeTab === "overview" ? <OverviewTab review={review} /> : null}
        {activeTab === "changes" ? <ChangesTab review={review} /> : null}
        {activeTab === "findings" ? (
          <FindingsTab findings={review.findings} onUpdateDisposition={handleUpdateDisposition} />
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
          onConfirm={handleApprovalConfirm}
          onClose={() => setApprovalModalType(null)}
        />
      ) : null}
    </div>
  );
}
