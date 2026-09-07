import Link from "next/link";
import { AppShell, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";
import { loadViewerReviews } from "../../lib/review-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import { loadViewerWorkQueue } from "../../lib/work-queue.js";

export const metadata = {
  title: "My Work",
  description: "Your assigned findings, pending reviews, and change requests.",
};

export const dynamic = "force-dynamic";

/** One shape for both branches, so the markup does not fork with the data source. */
type QueueFinding = {
  fingerprint: string;
  severity: string;
  ruleId: string;
  message: string;
  path: string | null;
  reviewId: string;
  reviewLabel: string;
  pullRequestNumber: number | undefined;
};

type QueueReview = {
  id: string;
  repositoryName: string;
  pullRequestNumber: number | undefined;
  title: string;
  createdBy: string;
};

/**
 * Both branches carry the fields a queue card needs, so one mapper serves the demo fixtures and
 * the database rows alike.
 */
function asQueueReview(review: {
  id: string;
  repositoryName: string;
  pullRequestNumber: number | undefined;
  title: string;
  createdBy: string;
}): QueueReview {
  return {
    id: review.id,
    repositoryName: review.repositoryName,
    pullRequestNumber: review.pullRequestNumber,
    title: review.title,
    createdBy: review.createdBy,
  };
}

function prLabel(pullRequestNumber: number | undefined): string {
  return pullRequestNumber === undefined ? "" : `PR #${pullRequestNumber}`;
}

export default async function MyWorkPage() {
  const viewer = await viewerAuthorization();
  const listing = await loadViewerReviews(viewer.session, { fixtures: DEMO_REVIEWS });

  let assignedFindings: QueueFinding[] = [];
  let awaitingReviews: QueueReview[] = [];
  let changesRequested: QueueReview[] = [];

  if (listing.state === "fixtures") {
    assignedFindings = listing.reviews.flatMap((review) =>
      review.findings
        .filter((finding) => finding.assignees.length > 0 && finding.disposition === "open")
        .map((finding) => ({
          fingerprint: finding.fingerprint,
          severity: finding.severity,
          ruleId: finding.ruleId,
          message: finding.message,
          path: finding.path ?? null,
          reviewId: review.id,
          reviewLabel: review.repositoryName,
          pullRequestNumber: review.pullRequestNumber,
        })),
    );
    awaitingReviews = listing.reviews.filter((review) => review.decision === "pending").map(asQueueReview);
    changesRequested = listing.reviews.filter((review) => review.decision === "changes_requested").map(asQueueReview);
  } else if (listing.state === "ok") {
    const queue = await loadViewerWorkQueue(viewer.session);
    const byId = new Map(listing.reviews.map((review) => [review.id, review]));
    assignedFindings = queue.assignedFindings.map((finding) => {
      const review = byId.get(finding.reviewId);
      return {
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        ruleId: finding.ruleId,
        message: finding.message,
        path: finding.path,
        reviewId: finding.reviewId,
        reviewLabel: review?.repositoryName ?? finding.repositoryId,
        pullRequestNumber: review?.pullRequestNumber,
      };
    });
    awaitingReviews = listing.reviews.filter((review) => review.decision === "pending").map(asQueueReview);
    changesRequested = listing.reviews.filter((review) => review.decision === "changes_requested").map(asQueueReview);
  }

  if (listing.state === "signed-out") {
    return (
      <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "My Work" }]}>
        <main className="flex w-full flex-col gap-5 px-6 py-6" id="main-content">
          <header>
            <h1 className="text-2xl font-bold text-foreground">My Work</h1>
          </header>
          <Panel title="Sign in required">
            <EmptyState title="Your queue is scoped to your installations">
              <p>Sign in with GitHub so BoardReadyOps knows which findings are assigned to you.</p>
            </EmptyState>
          </Panel>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "My Work" }]}>
      <main className="flex w-full flex-col gap-5 px-6 py-6" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">My Work</h1>
          <p className="text-sm text-muted-foreground">
            Active items requiring your attention, triage, engineering decisions, or review sign-off.
          </p>
        </header>

        <section aria-label="Queue summary" className="flex flex-wrap gap-3">
          <span className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground">
            <strong className="text-foreground">{assignedFindings.length}</strong> assigned findings
          </span>
          <span className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground">
            <strong className="text-foreground">{awaitingReviews.length}</strong> awaiting review
          </span>
          <span className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground">
            <strong className="text-foreground">{changesRequested.length}</strong> changes requested
          </span>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="min-w-0">
            <Panel
              title="Assigned Findings"
              description="DRC, clearance, and BOM findings assigned to you for disposition."
              tone="raised"
            >
              {assignedFindings.length === 0 ? (
                <EmptyState title="No assigned findings">
                  <p>You have no open assigned findings.</p>
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {assignedFindings.map((finding) => (
                    <article key={finding.fingerprint} className="rounded-md border border-border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <StatusBadge
                          value={finding.severity === "critical" || finding.severity === "error" ? "danger" : "warning"}
                          label={finding.severity}
                        />
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{finding.ruleId}</code>
                        <span className="text-muted-foreground">{finding.reviewLabel}</span>
                        <span className="text-muted-foreground">{prLabel(finding.pullRequestNumber)}</span>
                      </div>
                      <p className="text-sm text-foreground">{finding.message}</p>
                      <code className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                        {finding.path}
                      </code>
                      <div className="mt-3">
                        <Link
                          href={`/reviews/${finding.reviewId}?tab=findings`}
                          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                        >
                          Triage in {prLabel(finding.pullRequestNumber) || "this review"} →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <aside className="flex min-w-0 flex-col gap-5">
            <Panel
              title="Awaiting Your Review"
              description="Hardware pull requests waiting for engineering review or sign-off."
            >
              {awaitingReviews.length === 0 ? (
                <EmptyState title="No pending reviews">
                  <p>You are all caught up on review requests.</p>
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {awaitingReviews.map((review) => (
                    <article key={review.id} className="rounded-md bg-muted p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{review.repositoryName}</span>
                        <span>{prLabel(review.pullRequestNumber)}</span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-foreground">{review.title}</h4>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Author: {review.createdBy}</span>
                        <Link
                          href={`/reviews/${review.id}`}
                          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Open Review →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            {changesRequested.length > 0 ? (
              <Panel
                title="Changes Requested on Your PRs"
                description="Revisions requiring design updates before fabrication."
                tone="critical"
              >
                <div className="flex flex-col gap-3">
                  {changesRequested.map((review) => (
                    <article key={review.id} className="rounded-md bg-muted p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{review.repositoryName}</span>
                        <span>{prLabel(review.pullRequestNumber)}</span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-foreground">{review.title}</h4>
                      <div className="mt-2">
                        <Link
                          href={`/reviews/${review.id}?tab=discussion`}
                          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                        >
                          View Required Changes →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>
            ) : null}
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
