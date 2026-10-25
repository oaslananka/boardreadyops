import Link from "next/link";
import { displayReviewAuthor } from "../../lib/review-author-display.js";
import type { ReviewListEntry } from "../../lib/review-listing.js";
import { StatusBadge } from "../ui.js";

export function ReviewRegistryCard({ review }: Readonly<{ review: ReviewListEntry }>) {
  const pending = review.decision === "pending";
  const updated = review.updatedAt ? review.updatedAt.replace("T", " ").slice(0, 16) : undefined;
  const href = `/reviews/${review.id}`;

  return (
    <li>
      <article
        aria-label={`Review: ${review.title}`}
        className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-e1 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-e2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/25"
      >
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge value={review.decision} />
              <span className="text-muted-foreground" aria-hidden="true">
                /
              </span>
              <span className="min-w-0 break-words font-medium text-muted-foreground">{review.repositoryName}</span>
              {review.pullRequestNumber ? (
                <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-medium text-muted-foreground">
                  PR #{review.pullRequestNumber}
                </span>
              ) : (
                <span className="text-muted-foreground">Manual review</span>
              )}
            </div>
            <h2 className="max-w-3xl text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl">
              <Link
                href={href}
                className="rounded-sm decoration-primary/40 underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {review.title}
              </Link>
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${review.status === "active" ? "bg-success" : "bg-muted-foreground"}`}
                  aria-hidden="true"
                />
                {review.status === "active" ? "Active review" : `Status: ${review.status}`}
              </span>
              <span aria-hidden="true">·</span>
              <span>Opened by {displayReviewAuthor(review.createdBy)}</span>
              {updated ? (
                <>
                  <span aria-hidden="true">·</span>
                  <time dateTime={review.updatedAt}>Updated {updated}</time>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className="text-xs font-medium text-muted-foreground">
              {pending ? "Decision needed" : "Review evidence"}
            </span>
            <Link
              href={href}
              aria-label={`Open review: ${review.title}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary/35 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {pending ? "Inspect and decide" : "Open review"}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}
