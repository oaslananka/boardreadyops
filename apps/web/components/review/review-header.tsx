"use client";

import type { ReviewDecision, ReviewStatus } from "@boardreadyops/contracts";
import Link from "next/link";
import { CopyButton } from "../copy-button.js";
import { Button } from "../ui/button.js";
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
    <header className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-lg sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href="/reviews" className="hover:text-foreground hover:underline">
            ← Reviews
          </Link>
          <span aria-hidden="true">/</span>
          <span>{repositoryName}</span>
          <span aria-hidden="true">/</span>
          <span>PR #{pullRequestNumber}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">Rev {currentRevisionSequence}</span>
          <StatusBadge value={status} />
        </div>

        <h1 className="text-xl font-bold text-foreground">{title}</h1>

        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge value={decisionTone} label={decisionLabel} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Digest:</span>
            <code className="rounded-sm bg-muted px-1.5 py-0.5">
              {evidenceDigest.slice(0, 10)}...{evidenceDigest.slice(-6)}
            </code>
            <CopyButton value={evidenceDigest} label="Copy digest" />
            <span
              className={`inline-block size-2 rounded-full ${evidenceState === "current" ? "bg-success" : "bg-warning"}`}
              title={`Evidence is ${evidenceState}`}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 sm:items-end">
        <div className="flex items-center gap-2">
          <Button variant={isApproved ? "secondary" : "default"} onClick={() => onApprove?.()}>
            {isApproved ? "✓ Approved" : "Approve review"}
          </Button>
          <Button variant="destructive" onClick={() => onRequestChanges?.()}>
            Request changes
          </Button>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <code>{baseCommitSha.slice(0, 7)}</code>
          <span aria-hidden="true">→</span>
          <code>{headCommitSha.slice(0, 7)}</code>
        </div>
      </div>
    </header>
  );
}
