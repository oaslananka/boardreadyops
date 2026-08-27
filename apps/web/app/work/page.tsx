import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "My Work · BoardReadyOps",
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
      <main className="shell my-work-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "My Work" }]} />

        <header className="page-heading">
          <h1>My Work</h1>
          <p>Active items requiring your attention, triage, engineering decisions, or review sign-off.</p>
        </header>

        <div className="my-work-grid">
          <section className="work-section">
            <Panel
              title="Assigned Findings"
              description="DRC, clearance, and BOM findings assigned to you for disposition."
            >
              {assignedFindings.length === 0 ? (
                <EmptyState title="No assigned findings">
                  <p>You have no open assigned findings.</p>
                </EmptyState>
              ) : (
                <div className="work-findings-list">
                  {assignedFindings.map((finding) => (
                    <div key={finding.fingerprint} className="work-finding-card panel">
                      <div className="card-top">
                        <span className={`severity-pill ${finding.severity}`}>{finding.severity}</span>
                        <code className="rule-name">{finding.ruleId}</code>
                        <span className="repo-tag">{finding.review.repositoryName}</span>
                      </div>
                      <p className="msg">{finding.message}</p>
                      <div className="card-bot">
                        <span className="loc">📄 {finding.path}</span>
                        <Link
                          href={`/reviews/${finding.review.id}?tab=findings`}
                          className="button button-small button-secondary"
                        >
                          Triage in PR #{finding.review.pullRequestNumber} →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <section className="work-section">
            <Panel
              title="Awaiting Your Review"
              description="Hardware pull requests waiting for engineering review or sign-off."
            >
              {awaitingReviews.length === 0 ? (
                <EmptyState title="No pending reviews">
                  <p>You are all caught up on review requests.</p>
                </EmptyState>
              ) : (
                <div className="work-reviews-list">
                  {awaitingReviews.map((r) => (
                    <div key={r.id} className="work-review-card panel">
                      <div className="card-top">
                        <span className="repo-title">{r.repositoryName}</span>
                        <span className="pr-tag">PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4>{r.title}</h4>
                      <div className="card-bot">
                        <span className="author">Author: {r.createdBy}</span>
                        <Link href={`/reviews/${r.id}`} className="button button-small button-primary">
                          Open Review →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {changesRequested.length > 0 ? (
              <Panel
                title="Changes Requested on Your PRs"
                description="Revisions requiring design updates before fabrication."
              >
                <div className="work-reviews-list">
                  {changesRequested.map((r) => (
                    <div key={r.id} className="work-review-card panel">
                      <div className="card-top">
                        <span className="repo-title">{r.repositoryName}</span>
                        <span className="pr-tag">PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4>{r.title}</h4>
                      <div className="card-bot">
                        <Link href={`/reviews/${r.id}?tab=discussion`} className="button button-small button-danger">
                          View Required Changes →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
