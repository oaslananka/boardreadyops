import Link from "next/link";
import { ReviewEmptyVisualPreview } from "../../components/review/review-empty-visual-preview.js";
import { ReviewListFilterBar } from "../../components/review/review-list-filters.js";
import { ReviewListItem } from "../../components/review/review-list-item.js";
import { ReviewRegistryCard } from "../../components/review/review-registry-card.js";
import { Button } from "../../components/ui/button.js";
import { AppShell, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";
import {
  applyReviewListFilters,
  hasActiveReviewFilter,
  parseReviewListFilters,
  reviewListFacets,
  reviewListSorts,
  reviewSortLabels,
} from "../../lib/review-list-filters.js";
import { loadViewerReviews } from "../../lib/review-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Hardware Reviews",
  description: "All active and completed hardware reviews and sign-offs across every supported CAD format.",
};

export const dynamic = "force-dynamic";

function NoMatchingReviews() {
  return (
    <Panel title="No matching reviews">
      <EmptyState
        title="No review matches these filters"
        action={
          <Link href="/reviews" className="text-primary underline underline-offset-2">
            Clear the filters
          </Link>
        }
      >
        <p>Widen the search, or pick a different decision, status, or repository.</p>
      </EmptyState>
    </Panel>
  );
}

function ReviewPublishingGuidance() {
  return (
    <Panel id="publish-review" title="Publish a Review" tone="section">
      <p className="text-sm text-muted-foreground">
        Runs report findings; Reviews are separate, explicitly published records. Triage the source, then use{" "}
        <code>boardreadyops review publish</code> from an authorized local checkout. It creates a new run/review; verify
        its exact head commit and evidence before approval.
      </p>
    </Panel>
  );
}

type ReviewsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewsListPage({ searchParams }: Readonly<ReviewsPageProps>) {
  const filters = parseReviewListFilters(await searchParams);
  const viewer = await viewerAuthorization();
  const listing = await loadViewerReviews(viewer.session, { fixtures: DEMO_REVIEWS });

  if (listing.state === "signed-out") {
    return (
      <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Reviews" }]}>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
          <header>
            <h1 className="text-2xl font-bold text-foreground">Hardware Reviews</h1>
          </header>
          <ReviewEmptyVisualPreview />
          <Panel title="Sign in required">
            <EmptyState
              title="Reviews are scoped to your installations"
              action={
                <Button asChild>
                  <a href="/api/auth/github/login">Sign in with GitHub</a>
                </Button>
              }
            >
              <p>Sign in with GitHub so BoardReadyOps knows which repositories you can see.</p>
            </EmptyState>
          </Panel>
          <ReviewPublishingGuidance />
        </main>
      </AppShell>
    );
  }

  const total = listing.reviews.length;
  const awaiting = listing.reviews.filter((review) => review.decision === "pending").length;
  const facets = reviewListFacets(listing.reviews);
  const filtered = hasActiveReviewFilter(filters);

  // Live cards use only source-authorized data; never invent blockers or geometry.
  let reviewsBody = <ReviewEmptyVisualPreview />;
  let shown = 0;
  if (listing.state === "fixtures") {
    const visible = applyReviewListFilters(listing.reviews, filters);
    shown = visible.length;
    if (visible.length > 0) {
      reviewsBody = (
        <section className="grid grid-cols-1 gap-3" aria-label="Hardware reviews across visible repositories">
          {visible.map((review) => (
            <ReviewListItem key={review.id} review={review} context="registry" />
          ))}
        </section>
      );
    } else if (total > 0) {
      reviewsBody = <NoMatchingReviews />;
    }
  } else {
    const visible = applyReviewListFilters(listing.reviews, filters);
    shown = visible.length;
    if (visible.length > 0) {
      reviewsBody = (
        <ul className="flex flex-col gap-3" aria-label="Hardware reviews across visible repositories">
          {visible.map((review) => (
            <ReviewRegistryCard key={review.id} review={review} />
          ))}
        </ul>
      );
    } else if (total > 0) {
      reviewsBody = <NoMatchingReviews />;
    }
  }

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Reviews" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Hardware review workspace
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Hardware Reviews</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              See what needs a decision, then inspect source-linked design evidence.
            </p>
          </div>
          {total > 0 ? (
            <Link
              href="/runs"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:border-primary/40 hover:text-primary"
            >
              View run history <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </header>

        {total > 0 ? (
          <ReviewListFilterBar
            filters={filters}
            facets={facets}
            sorts={reviewListSorts}
            sortLabels={reviewSortLabels}
            shown={shown}
            total={total}
            awaiting={awaiting}
            filtered={filtered}
          />
        ) : null}

        {reviewsBody}
        <ReviewPublishingGuidance />
      </main>
    </AppShell>
  );
}
