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

function getDecisionMeta(decision: ReviewDecision): { label: string; tone: "passed" | "failed" | "warning" } {
  if (decision === "approved") return { label: "Approved", tone: "passed" };
  if (decision === "changes_requested") return { label: "Changes requested", tone: "failed" };
  return { label: "Awaiting decision", tone: "warning" };
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
}: Readonly<ReviewHeaderProps>) {
  const { label: decisionLabel, tone: decisionTone } = getDecisionMeta(decision);
  const isApproved = decision === "approved";

  return (
    <header className="review-command-header panel surface-raised">
      <div className="command-header-lead">
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
        </div>

        <h1 className="review-title">{title}</h1>

        <div className="review-decision-summary">
          <StatusBadge value={decisionTone} label={decisionLabel} />
          <div className="evidence-digest-pill">
            <span className="digest-label">Digest:</span>
            <code className="digest-sha">
              {evidenceDigest.slice(0, 10)}...{evidenceDigest.slice(-6)}
            </code>
            <CopyButton value={evidenceDigest} label="Copy digest" />
            <span
              className={`evidence-status-dot ${evidenceState === "current" ? "valid" : "stale"}`}
              title={`Evidence is ${evidenceState}`}
            />
          </div>
        </div>
      </div>

      <div className="command-header-actions">
        <div className="review-actions-bar">
          <button
            type="button"
            className={`button ${isApproved ? "button-secondary" : "button-primary"}`}
            onClick={() => onApprove?.()}
          >
            {isApproved ? "✓ Approved" : "Approve review"}
          </button>
          <button type="button" className="button button-danger" onClick={() => onRequestChanges?.()}>
            Request changes
          </button>
        </div>

        <div className="commit-comparison">
          <code>{baseCommitSha.slice(0, 7)}</code>
          <span className="arrow">→</span>
          <code>{headCommitSha.slice(0, 7)}</code>
        </div>
      </div>
    </header>
  );
}
