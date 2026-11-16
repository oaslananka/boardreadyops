import { ArrowRight, FileCheck2, GitPullRequest, ScanEye } from "lucide-react";
import Link from "next/link";
import { canonicalRepositoryName } from "../lib/review-list-filters.js";
import type { RunListingEntry } from "../lib/run-listing.js";
import { nextRunReviewAction } from "../lib/run-review-action.js";
import { RunStateIndicators } from "./run-state-indicators.js";

type ReviewPathRun = Pick<RunListingEntry, "id" | "repository" | "status" | "decision">;

const linkClass =
  "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function reviewHistoryHref(repository: string): string | undefined {
  const canonical = canonicalRepositoryName(repository);
  return canonical ? `/reviews?repository=${encodeURIComponent(canonical)}` : undefined;
}

/** Only the caller's authorization-scoped Run listing is rendered. No cross-tenant fallback query. */
export function RunReviewQueue({ runs }: Readonly<{ runs: readonly RunListingEntry[] }>) {
  if (runs.length === 0) return null;
  return (
    <section
      aria-labelledby="run-review-queue-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">Pick up where you left off</p>
          <h2
            id="run-review-queue-heading"
            className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground"
          >
            Continue a hardware review
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Open a recorded check, inspect its board and findings, then verify its evidence. A readiness result is not a
            fabrication authorization.
          </p>
        </div>
        <Link href="/reviews" className={linkClass}>
          All Review decisions <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <ol className="mt-5 grid gap-3 lg:grid-cols-3" aria-label="Latest recorded hardware checks">
        {runs.slice(0, 3).map((run) => {
          const action = nextRunReviewAction(run);
          const reviewHref = reviewHistoryHref(run.repository);
          const runHref = `/runs/${encodeURIComponent(run.id)}`;
          return (
            <li
              key={run.id}
              className="flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-border bg-background/80 p-4"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Recorded check
                  </span>
                  <RunStateIndicators status={run.status} decision={run.decision} />
                </div>
                <h3 className="break-words font-semibold text-foreground">{run.repository}</h3>
                <p className="text-xs text-muted-foreground">
                  {run.pullRequestNumber !== undefined ? `PR #${run.pullRequestNumber}` : "Repository check"}
                  {" · "}
                  <code>{run.commitSha.slice(0, 7)}</code>
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">{action.description}</p>
              </div>
              <div className="space-y-3">
                <Link
                  href={action.href}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {action.label} <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                </Link>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <Link href={`${runHref}/design`} className={linkClass}>
                    Inspect board
                  </Link>
                  {reviewHref ? (
                    <Link href={reviewHref} className={linkClass}>
                      Review history
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A route-level path for evidence investigation, not an approval or release wizard. */
export function RunReviewPath({ run }: Readonly<{ run: ReviewPathRun }>) {
  const runHref = `/runs/${encodeURIComponent(run.id)}`;
  const reviewHref = reviewHistoryHref(run.repository);
  const steps = [
    {
      href: `${runHref}/design`,
      title: "Inspect the board",
      description: "View recorded PCB or schematic snapshots, if this check published them.",
      icon: ScanEye,
    },
    {
      href: `${runHref}/findings`,
      title: "Inspect findings",
      description: "Examine what the run actually reported; missing evidence is not a pass.",
      icon: GitPullRequest,
    },
    {
      href: `${runHref}/artifacts`,
      title: "Check recorded artifacts",
      description: "If available, check recorded source, checksum, signature and expiry before sharing.",
      icon: FileCheck2,
    },
  ] as const;
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-e1 sm:p-6"
      aria-labelledby="review-path-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">Your review path</p>
          <h2 id="review-path-heading" className="mt-2 font-display text-xl font-semibold text-foreground">
            From board evidence to a reviewable handoff
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow this run's recorded evidence in order. Each step shows unavailable or incomplete data explicitly.
          </p>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.href} className="flex min-w-0 flex-col rounded-xl border border-border bg-background/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">STEP {index + 1}</span>
              <step.icon className="size-5 text-primary" aria-hidden="true" />
            </div>
            <Link
              href={step.href}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {step.title} <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3">
        {reviewHref ? (
          <Link href={reviewHref} className={linkClass}>
            Open repository Reviews
          </Link>
        ) : null}
        <Link href="/deliveries" className={linkClass}>
          Check delivery eligibility
        </Link>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Delivery requires separate authorization. A passing readiness check, a Review decision, or a signed archive
        alone never grants manufacturing approval.
      </p>
    </section>
  );
}
