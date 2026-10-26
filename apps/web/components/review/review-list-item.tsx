import Link from "next/link";
import type { DemoReview } from "../../lib/demo-data.js";
import { Badge } from "../ui/badge.js";
import { StatusBadge } from "../ui.js";

function getDecisionMeta(decision: DemoReview["decision"]): { label: string; tone: "passed" | "failed" | "warning" } {
  if (decision === "approved") return { label: "Approved", tone: "passed" };
  if (decision === "changes_requested") return { label: "Changes requested", tone: "failed" };
  return { label: "Awaiting decision", tone: "warning" };
}

function getBlockerLabel(count: number): string {
  if (count === 1) return "1 blocker";
  if (count > 0) return `${count} blockers`;
  return "No blockers";
}

export function ReviewListItem({
  review,
  context: _context = "registry",
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

  const { label: decisionLabel, tone: decisionTone } = getDecisionMeta(review.decision);
  const blockerLabel = getBlockerLabel(blockingCount);

  return (
    <Link
      href={`/reviews/${review.id}`}
      className="group block rounded-xl border border-border bg-card shadow-e1 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`Open review: ${review.title}`}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium">{review.repositoryName}</span>
            <span aria-hidden="true">/</span>
            <span>{review.pullRequestNumber > 0 ? `PR #${review.pullRequestNumber}` : "Manual review"}</span>
            <span aria-hidden="true">·</span>
            <span>Rev {review.currentRevisionSequence}</span>
          </div>
          <h3 className="max-w-3xl text-lg font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-xl">
            {review.title}
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <code>{/^0+$/u.test(review.baseCommitSha) ? "No base" : review.baseCommitSha.slice(0, 7)}</code>
            <span aria-hidden="true">→</span>
            <code>{review.headCommitSha.slice(0, 7)}</code>
            <span aria-hidden="true">·</span>
            <span>by {review.createdBy}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <StatusBadge value={decisionTone} label={decisionLabel} />
          <span className={`text-xs font-semibold ${blockingCount > 0 ? "text-danger" : "text-muted-foreground"}`}>
            {blockerLabel}
          </span>
          <span className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-primary">
            {review.decision === "pending" ? "Inspect and decide" : "Open review"} <span aria-hidden="true">↗</span>
          </span>
        </div>
      </div>
      {newCount + persistentCount + resolvedCount > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-border/60 px-5 py-3 sm:px-6">
          {newCount > 0 ? <Badge variant="info">+{newCount} new</Badge> : null}
          {persistentCount > 0 ? <Badge variant="secondary">{persistentCount} persistent</Badge> : null}
          {resolvedCount > 0 ? <Badge variant="success">✓ {resolvedCount} resolved</Badge> : null}
        </div>
      ) : null}
    </Link>
  );
}
