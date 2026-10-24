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
  headRunId?: string | undefined;
  baseRunId?: string | undefined;
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
  headRunId,
  baseRunId,
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
    <header className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-e2 sm:gap-4 sm:p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:text-sm">
          <Link href="/reviews" className="hover:text-foreground hover:underline">
            ← Reviews
          </Link>
          <span aria-hidden="true">/</span>
          <span className="min-w-0 max-w-32 truncate sm:max-w-none sm:break-all" title={repositoryName}>
            {repositoryName}
          </span>
          <span aria-hidden="true">/</span>
          <span>{pullRequestNumber > 0 ? `PR #${pullRequestNumber}` : "Manual review"}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">Rev {currentRevisionSequence}</span>
          <span className="hidden sm:inline-flex">
            <StatusBadge value={status} />
          </span>
        </div>

        <h1
          className="line-clamp-2 text-base font-bold text-balance text-foreground sm:line-clamp-none sm:text-title"
          title={title}
        >
          {title}
        </h1>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <StatusBadge value={decisionTone} label={decisionLabel} />
          <span className="sm:hidden">
            <StatusBadge value={status} />
          </span>
          <span
            role="img"
            aria-label={`Evidence is ${evidenceState}`}
            title={`Evidence is ${evidenceState}`}
            className={`inline-block size-2 sm:hidden ${evidenceState === "current" ? "bg-success" : "bg-warning"}`}
          />
          <div className="hidden min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground sm:flex">
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

        <details className="group rounded-md border border-border/70 bg-background/30 sm:hidden">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <span>Review actions & evidence</span>
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-border p-3">
            {headRunId ? (
              <nav aria-label="Review source runs" className="flex flex-wrap gap-3 text-sm">
                {baseRunId ? (
                  <Link
                    href={`/runs/${encodeURIComponent(baseRunId)}`}
                    className="text-primary underline underline-offset-2"
                  >
                    Base run
                  </Link>
                ) : null}
                <Link
                  href={`/runs/${encodeURIComponent(headRunId)}`}
                  className="text-primary underline underline-offset-2"
                >
                  Review head run →
                </Link>
              </nav>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={isApproved ? "secondary" : "default"} onClick={() => onApprove?.()}>
                {isApproved ? "✓ Approved" : "Approve review"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onRequestChanges?.()}>
                Request changes
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <code>
                {/^0+$/u.test(baseCommitSha) ? "No base" : baseCommitSha.slice(0, 7)} → {headCommitSha.slice(0, 7)}
              </code>
              <CopyButton value={evidenceDigest} label="Copy digest" />
            </div>
          </div>
        </details>
      </div>

      <div className="hidden min-w-0 flex-col items-start gap-2 sm:flex sm:gap-3 sm:items-end">
        {headRunId ? (
          <nav aria-label="Review source runs" className="flex flex-wrap gap-3 text-xs sm:text-sm">
            {baseRunId ? (
              <Link
                href={`/runs/${encodeURIComponent(baseRunId)}`}
                className="text-primary underline underline-offset-2"
              >
                Base run
              </Link>
            ) : null}
            <Link href={`/runs/${encodeURIComponent(headRunId)}`} className="text-primary underline underline-offset-2">
              Review head run →
            </Link>
          </nav>
        ) : null}
        <div className="flex max-w-full flex-wrap items-center gap-2 sm:flex-nowrap">
          <Button size="sm" variant={isApproved ? "secondary" : "default"} onClick={() => onApprove?.()}>
            {isApproved ? "✓ Approved" : "Approve review"}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onRequestChanges?.()}>
            Request changes
          </Button>
        </div>

        <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <code>{/^0+$/u.test(baseCommitSha) ? "No base" : baseCommitSha.slice(0, 7)}</code>
          <span aria-hidden="true">→</span>
          <code>{headCommitSha.slice(0, 7)}</code>
        </div>
      </div>
    </header>
  );
}
