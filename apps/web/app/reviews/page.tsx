import { ReviewListItem } from "../../components/review/review-list-item.js";
import { AppShell, Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "Hardware Reviews · BoardReadyOps",
  description: "All active and completed KiCad hardware reviews and sign-offs.",
};

export default function ReviewsListPage() {
  const reviews = DEMO_REVIEWS;
  const activeCount = reviews.filter((review) => review.decision === "pending").length;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Reviews" }]} />

        <header className="page-intro">
          <h1>Hardware Reviews</h1>
          <p>Decision-ready hardware design reviews across all repositories and pull requests.</p>
        </header>

        <section className="review-registry-toolbar decision-band" aria-label="Review registry summary">
          <div className="metric-strip">
            <span className="metric-pill">
              Showing <strong>{reviews.length}</strong> review{reviews.length === 1 ? "" : "s"} (
              <strong>{activeCount}</strong> awaiting a decision)
            </span>
          </div>
        </section>

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
              {reviews.map((rev) => (
                <ReviewListItem key={rev.id} review={rev} context="registry" />
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
