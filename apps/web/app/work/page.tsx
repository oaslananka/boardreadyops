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

  // Flatten assigned findings across reviews
  const assignedFindings = reviews.flatMap((r) =>
    r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open").map((f) => ({ ...f, review: r })),
  );

  // Reviews awaiting review/decision
  const awaitingReviews = reviews.filter((r) => r.decision === "pending");

  // Reviews where changes are requested
  const changesRequested = reviews.filter((r) => r.decision === "changes_requested");

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "My Work" }]} />

        <header className="page-intro">
          <h1>My Work</h1>
          <p>Active items requiring your attention, triage, engineering decisions, or review sign-off.</p>
        </header>

        <section className="work-queue-summary decision-band" aria-label="Queue summary">
          <div className="metric-strip">
            <span className="metric-pill">
              <strong>{assignedFindings.length}</strong> assigned findings
            </span>
            <span className="metric-pill">
              <strong>{awaitingReviews.length}</strong> awaiting review
            </span>
            <span className="metric-pill">
              <strong>{changesRequested.length}</strong> changes requested
            </span>
          </div>
        </section>

        <div className="work-workspace-grid">
          <section className="work-primary-queue">
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
                <div className="work-findings-list">
                  {assignedFindings.map((finding) => (
                    <article key={finding.fingerprint} className="work-finding-row panel surface-default">
                      <div className="finding-row-lead">
                        <div className="finding-meta">
                          <StatusBadge
                            value={
                              finding.severity === "critical" || finding.severity === "error" ? "danger" : "warning"
                            }
                            label={finding.severity}
                          />
                          <code className="rule-id">{finding.ruleId}</code>
                          <span className="repo-tag">{finding.review.repositoryName}</span>
                          <span className="pr-tag">PR #{finding.review.pullRequestNumber}</span>
                        </div>
                        <p className="finding-message">{finding.message}</p>
                        <span className="finding-path">
                          <code>{finding.path}</code>
                        </span>
                      </div>
                      <div className="finding-row-action">
                        <Link href={`/reviews/${finding.review.id}?tab=findings`} className="button button-secondary">
                          Triage in PR #{finding.review.pullRequestNumber} →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <aside className="work-secondary-queues">
            <Panel
              title="Awaiting Your Review"
              description="Hardware pull requests waiting for engineering review or sign-off."
              tone="default"
            >
              {awaitingReviews.length === 0 ? (
                <EmptyState title="No pending reviews">
                  <p>You are all caught up on review requests.</p>
                </EmptyState>
              ) : (
                <div className="work-reviews-list">
                  {awaitingReviews.map((r) => (
                    <article key={r.id} className="work-review-card panel surface-inset">
                      <div className="card-top">
                        <span className="repo-title">{r.repositoryName}</span>
                        <span className="pr-tag">PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4>{r.title}</h4>
                      <div className="card-bot">
                        <span className="author">Author: {r.createdBy}</span>
                        <Link href={`/reviews/${r.id}`} className="button button-primary button-small">
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
                <div className="work-reviews-list">
                  {changesRequested.map((r) => (
                    <article key={r.id} className="work-review-card panel surface-inset">
                      <div className="card-top">
                        <span className="repo-title">{r.repositoryName}</span>
                        <span className="pr-tag">PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4>{r.title}</h4>
                      <div className="card-bot">
                        <Link href={`/reviews/${r.id}?tab=discussion`} className="button button-secondary button-small">
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
