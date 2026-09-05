import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "My Work",
  description: "Your assigned findings, pending reviews, and change requests.",
};

export default function MyWorkPage() {
  const reviews = DEMO_REVIEWS;

  const assignedFindings = reviews.flatMap((r) =>
    r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open").map((f) => ({ ...f, review: r })),
  );

  const awaitingReviews = reviews.filter((r) => r.decision === "pending");

  const changesRequested = reviews.filter((r) => r.decision === "changes_requested");

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="flex flex-col gap-5 px-6 py-6" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "My Work" }]} />

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

        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <section>
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
                        <span className="text-muted-foreground">{finding.review.repositoryName}</span>
                        <span className="text-muted-foreground">PR #{finding.review.pullRequestNumber}</span>
                      </div>
                      <p className="text-sm text-foreground">{finding.message}</p>
                      <code className="mt-1 block font-mono text-xs text-muted-foreground">{finding.path}</code>
                      <div className="mt-3">
                        <Link
                          href={`/reviews/${finding.review.id}?tab=findings`}
                          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/10"
                        >
                          Triage in PR #{finding.review.pullRequestNumber} →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <aside className="flex flex-col gap-5">
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
                  {awaitingReviews.map((r) => (
                    <article key={r.id} className="rounded-md bg-muted p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{r.repositoryName}</span>
                        <span>PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-foreground">{r.title}</h4>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Author: {r.createdBy}</span>
                        <Link
                          href={`/reviews/${r.id}`}
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
                  {changesRequested.map((r) => (
                    <article key={r.id} className="rounded-md bg-muted p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{r.repositoryName}</span>
                        <span>PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-foreground">{r.title}</h4>
                      <div className="mt-2">
                        <Link
                          href={`/reviews/${r.id}?tab=discussion`}
                          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/10"
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
