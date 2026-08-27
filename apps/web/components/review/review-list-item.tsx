import Link from "next/link";
import type { DemoReview } from "../../lib/demo-data.js";
import { StatusBadge } from "../ui.js";

export function ReviewListItem({
  review,
  context = "registry",
}: Readonly<{
  review: DemoReview;
  context?: "registry" | "work";
}>) {
  const newCount = review.findings.filter((f) => f.diffState === "new").length;
  const persistentCount = review.findings.filter((f) => f.diffState === "persistent").length;
  const resolvedCount = review.findings.filter((f) => f.diffState === "resolved").length;
  const blockingCount = review.findings.filter(
    (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
  ).length;

  const isApproved = review.decision === "approved";
  const isChangesRequested = review.decision === "changes_requested";

  const decisionLabel = isApproved ? "Approved" : isChangesRequested ? "Changes requested" : "Awaiting decision";
  const decisionTone = isApproved ? "passed" : isChangesRequested ? "failed" : "warning";

  const blockerLabel =
    blockingCount === 1 ? "1 blocker" : blockingCount > 0 ? `${blockingCount} blockers` : "No blockers";

  return (
    <Link
      href={`/reviews/${review.id}`}
      className={`review-registry-row review-registry-row-${context} panel surface-raised`}
    >
      <div className="row-lead">
        <div className="row-meta">
          <span className="repo-tag">{review.repositoryName}</span>
          <span className="pr-tag">PR #{review.pullRequestNumber}</span>
          <span className="revision-tag">Rev {review.currentRevisionSequence}</span>
        </div>
        <h3 className="row-title">{review.title}</h3>
      </div>

      <div className="row-decision-cell">
        <StatusBadge value={decisionTone} label={decisionLabel} />
        <span className={`blocker-indicator ${blockingCount > 0 ? "has-blockers" : "no-blockers"}`}>
          {blockerLabel}
        </span>
      </div>

      <div className="row-technical-detail">
        <span className="commit-span">
          <code>{review.baseCommitSha.slice(0, 7)}</code> → <code>{review.headCommitSha.slice(0, 7)}</code>
        </span>
        <span className="author-tag">by {review.createdBy}</span>
      </div>

      <div className="row-lifecycle-counts">
        {newCount > 0 ? <span className="diff-pill new">+{newCount} new</span> : null}
        {persistentCount > 0 ? <span className="diff-pill persistent">{persistentCount} persistent</span> : null}
        {resolvedCount > 0 ? <span className="diff-pill resolved">✓ {resolvedCount} resolved</span> : null}
      </div>
    </Link>
  );
}
