import Link from "next/link";
import type { DemoReview } from "../../lib/demo-data.js";
import { Button } from "../ui/button.js";

type HandoffReview = Pick<DemoReview, "id" | "decision" | "headRunId">;

/** A Review is evidence, never a source-to-export manufacturing authorization. */
export function ManufacturingHandoffPath({
  review,
  blockingCount,
  reviewChecksMet,
  onOpenFindings,
}: Readonly<{
  review: HandoffReview;
  blockingCount: number;
  reviewChecksMet: boolean;
  onOpenFindings?: (() => void) | undefined;
}>) {
  const changesRequested = review.decision === "changes_requested";
  const reviewBlocked = changesRequested || blockingCount > 0;
  const reviewState = changesRequested
    ? "Changes requested"
    : blockingCount > 0
      ? `${blockingCount} open blockers`
      : reviewChecksMet
        ? "Review checks met"
        : "Review checks pending";
  const artifactsHref = review.headRunId ? `/runs/${encodeURIComponent(review.headRunId)}/artifacts` : "/runs";

  return (
    <section
      aria-label="Manufacturing handoff path"
      className="rounded-lg border border-border bg-card p-3 shadow-e1 sm:p-5"
    >
      <div className="max-w-2xl">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">
          Next steps · manufacturing handoff
        </p>
        <h2 className="mt-1 text-lg font-bold text-foreground">From review to a shareable manufacturing package</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Work through the evidence in order. A Review decision does not prove a signed run, verified Gerbers, or
          permission to release a board for fabrication.
        </p>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        <li className="flex min-w-0 flex-col rounded-md border border-border bg-background/60 p-3">
          <p className="text-xs font-semibold text-muted-foreground">01 · REVIEW</p>
          <h3 className="mt-1 font-semibold text-foreground">Resolve this revision</h3>
          <p className={`mt-1 text-xs font-medium ${reviewBlocked ? "text-danger" : "text-warning"}`}>{reviewState}</p>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">
            {changesRequested
              ? `A corrected source revision and a new decision are needed. ${blockingCount} recorded blocking finding(s) remain open.`
              : blockingCount > 0
                ? "Investigate unresolved blocking findings before requesting a new review decision."
                : reviewChecksMet
                  ? "The Review checks are met for this evidence digest; release readiness remains unverified."
                  : "Complete the Review checks and obtain an explicit evidence-bound decision."}
          </p>
          <div className="mt-3">
            {onOpenFindings ? (
              <Button type="button" variant="outline" size="sm" onClick={onOpenFindings}>
                Inspect findings
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={`/reviews/${encodeURIComponent(review.id)}?tab=findings`}>Inspect findings</Link>
              </Button>
            )}
          </div>
        </li>
        <li className="flex min-w-0 flex-col rounded-md border border-border bg-background/60 p-3">
          <p className="text-xs font-semibold text-muted-foreground">02 · EVIDENCE</p>
          <h3 className="mt-1 font-semibold text-foreground">Inspect exports and parts</h3>
          <p className="mt-1 text-xs font-medium text-warning">Not verified by this Review</p>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">
            Check the linked Run for an accepted signed result, BOM, Gerber files, and a stored manufacturing archive.
            Draft or missing exports are not delivery-eligible.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={artifactsHref}>{review.headRunId ? "Inspect Run artifacts" : "Browse Runs"}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={review.headRunId ? `/runs/${encodeURIComponent(review.headRunId)}#boards` : "/runs"}>
                {review.headRunId ? "Check BOM risk" : "Browse Runs"}
              </Link>
            </Button>
          </div>
        </li>
        <li className="flex min-w-0 flex-col rounded-md border border-border bg-background/60 p-3">
          <p className="text-xs font-semibold text-muted-foreground">03 · DELIVERY</p>
          <h3 className="mt-1 font-semibold text-foreground">Authorize a verified package</h3>
          <p className="mt-1 text-xs font-medium text-warning">Separate release authorization required</p>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">
            A source-bound verified package requires owner/admin permission before guest sharing. Guest links require
            Team or higher; this Review does not grant either.
          </p>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/deliveries">Check delivery eligibility</Link>
            </Button>
          </div>
        </li>
      </ol>
    </section>
  );
}
