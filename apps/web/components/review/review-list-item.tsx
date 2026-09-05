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
      className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 shadow-lg transition-colors hover:border-primary/50 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{review.repositoryName}</span>
          <span>PR #{review.pullRequestNumber}</span>
          <span>Rev {review.currentRevisionSequence}</span>
        </div>
        <h3 className="mt-1 text-sm font-bold text-foreground">{review.title}</h3>
      </div>

      <div className="flex flex-col items-start gap-1.5">
        <StatusBadge value={decisionTone} label={decisionLabel} />
        <span className={`text-xs ${blockingCount > 0 ? "text-danger" : "text-muted-foreground"}`}>{blockerLabel}</span>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>
          <code>{review.baseCommitSha.slice(0, 7)}</code> → <code>{review.headCommitSha.slice(0, 7)}</code>
        </span>
        <span>by {review.createdBy}</span>
      </div>

      <div className="flex flex-wrap items-start gap-1.5">
        {newCount > 0 ? <Badge variant="info">+{newCount} new</Badge> : null}
        {persistentCount > 0 ? <Badge variant="secondary">{persistentCount} persistent</Badge> : null}
        {resolvedCount > 0 ? <Badge variant="success">✓ {resolvedCount} resolved</Badge> : null}
      </div>
    </Link>
  );
}
