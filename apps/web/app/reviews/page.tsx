import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "Hardware Reviews · BoardReadyOps",
  description: "All active and completed KiCad hardware reviews and sign-offs.",
};

export default function ReviewsListPage() {
  const reviews = DEMO_REVIEWS;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Reviews" }]} />

        <header className="page-heading">
          <div className="heading-title-row">
            <div>
              <h1>Hardware Reviews</h1>
              <p>Decision-ready hardware design reviews across all repositories and pull requests.</p>
            </div>
          </div>
        </header>

        <div className="reviews-list-container">
          {reviews.length === 0 ? (
            <Panel title="No Reviews">
              <EmptyState title="No hardware reviews found">
                <p>
                  Publish a review via GitHub Action or CLI: <code>boardreadyops review publish</code>
                </p>
              </EmptyState>
            </Panel>
          ) : (
            <div className="reviews-grid">
              {reviews.map((rev) => {
                const newCount = rev.findings.filter((f) => f.diffState === "new").length;
                const persistentCount = rev.findings.filter((f) => f.diffState === "persistent").length;
                const resolvedCount = rev.findings.filter((f) => f.diffState === "resolved").length;
                const blockingCount = rev.findings.filter(
                  (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
                ).length;

                const isApproved = rev.decision === "approved";
                const isChangesRequested = rev.decision === "changes_requested";

                return (
                  <Link key={rev.id} href={`/reviews/${rev.id}`} className="review-card-link panel hover-lift">
                    <div className="review-card-header">
                      <div className="card-meta">
                        <span className="card-repo">{rev.repositoryName}</span>
                        <span className="card-pr">PR #{rev.pullRequestNumber}</span>
                        <span className="revision-pill">Rev {rev.currentRevisionSequence}</span>
                      </div>
                      <StatusBadge
                        value={isApproved ? "passed" : isChangesRequested ? "failed" : "warning"}
                        label={isApproved ? "Approved" : isChangesRequested ? "Changes Requested" : "Awaiting Decision"}
                      />
                    </div>

                    <h3 className="card-title">{rev.title}</h3>

                    <div className="card-commit-strip">
                      <code>{rev.baseCommitSha.slice(0, 7)}</code>
                      <span className="arrow">→</span>
                      <code>{rev.headCommitSha.slice(0, 7)}</code>
                      <span className="card-author">• by {rev.createdBy}</span>
                    </div>

                    <div className="card-lifecycle-pills">
                      {newCount > 0 ? <span className="diff-pill new">+{newCount} new</span> : null}
                      {persistentCount > 0 ? (
                        <span className="diff-pill persistent">{persistentCount} persistent</span>
                      ) : null}
                      {resolvedCount > 0 ? (
                        <span className="diff-pill resolved">✓ {resolvedCount} resolved</span>
                      ) : null}
                      {blockingCount > 0 ? (
                        <span className="diff-pill danger">! {blockingCount} blocking</span>
                      ) : (
                        <span className="diff-pill success">✓ No blockers</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
