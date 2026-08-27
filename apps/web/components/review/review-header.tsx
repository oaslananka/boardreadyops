"use client";

import type { ReviewDecision, ReviewStatus } from "@boardreadyops/contracts";
import Link from "next/link";
import { CopyButton } from "../copy-button.js";
import { StatusBadge } from "../ui.js";

export interface ReviewHeaderProps {
  reviewId: string;
  title: string;
  repositoryName: string;
  pullRequestNumber: number;
  status: ReviewStatus;
  decision: ReviewDecision;
  currentRevisionSequence: number;
  baseCommitSha: string;
  headCommitSha: string;
  evidenceDigest: string;
  evidenceState: string;
  onApprove?: () => void;
  onRequestChanges?: () => void;
}

export function ReviewHeader({
  reviewId: _reviewId,
  title,
  repositoryName,
  pullRequestNumber,
  status,
  decision,
  currentRevisionSequence,
  baseCommitSha,
  headCommitSha,
  evidenceDigest,
  evidenceState,
  onApprove,
  onRequestChanges,
}: ReviewHeaderProps) {
  const isApproved = decision === "approved";
  const isChangesRequested = decision === "changes_requested";

  return (
    <header className="review-detail-header panel">
      <div className="review-detail-header-top">
        <div className="review-meta-bar">
          <Link href="/reviews" className="review-back-link">
            ← Reviews
          </Link>
          <span className="separator">/</span>
          <span className="repo-name">{repositoryName}</span>
          <span className="separator">/</span>
          <span className="pr-badge">PR #{pullRequestNumber}</span>
          <span className="revision-pill">Rev {currentRevisionSequence}</span>
          <StatusBadge value={status} />
          <StatusBadge
            value={isApproved ? "passed" : isChangesRequested ? "failed" : "warning"}
            label={isApproved ? "Approved" : isChangesRequested ? "Changes Requested" : "Awaiting Decision"}
          />
        </div>

        <div className="review-actions-bar">
          <button
            type="button"
            className={`button ${isApproved ? "button-secondary" : "button-primary"}`}
            onClick={() => onApprove?.()}
          >
            {isApproved ? "✓ Approved" : "Approve Review"}
          </button>
          <button type="button" className="button button-danger" onClick={() => onRequestChanges?.()}>
            Request Changes
          </button>
        </div>
      </div>

      <h1 className="review-title">{title}</h1>

      <div className="review-commit-strip">
        <div className="commit-comparison">
          <span className="commit-label">Base:</span>
          <code className="commit-sha">{baseCommitSha.slice(0, 8)}</code>
          <span className="arrow">→</span>
          <span className="commit-label">Head:</span>
          <code className="commit-sha">{headCommitSha.slice(0, 8)}</code>
        </div>

        <div className="evidence-digest-pill">
          <span className="digest-label">Evidence Digest:</span>
          <code className="digest-sha">
            {evidenceDigest.slice(0, 12)}...{evidenceDigest.slice(-6)}
          </code>
          <CopyButton value={evidenceDigest} label="Copy digest" />
          <span
            className={`evidence-status-dot ${evidenceState === "current" ? "valid" : "stale"}`}
            title={`Evidence is ${evidenceState}`}
          />
        </div>
      </div>
    </header>
  );
}
