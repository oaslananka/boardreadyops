import { ReviewListItem } from "../../components/review/review-list-item.js";
import { AppShell, Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "Hardware Reviews",
  description: "All active and completed hardware reviews and sign-offs across every supported CAD format.",
};

export default function ReviewsListPage() {
  const reviews = DEMO_REVIEWS;
  const activeCount = reviews.filter((review) => review.decision === "pending").length;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Reviews" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">Hardware Reviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Decision-ready hardware design reviews across all repositories and pull requests.
          </p>
        </header>

        <section
          className="rounded-md border border-border bg-card px-4 py-3 text-sm"
          aria-label="Review registry summary"
        >
          Showing <strong>{reviews.length}</strong> review{reviews.length === 1 ? "" : "s"} (
          <strong>{activeCount}</strong> awaiting a decision)
        </section>

        {reviews.length === 0 ? (
          <Panel title="No Reviews">
            <EmptyState title="No hardware reviews found">
              <p>
                Publish a review via GitHub Action or CLI: <code>boardreadyops review publish</code>
              </p>
            </EmptyState>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {reviews.map((rev) => (
              <ReviewListItem key={rev.id} review={rev} context="registry" />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
