import Link from "next/link";
import { ReviewListFilterBar } from "../../components/review/review-list-filters.js";
import { ReviewListItem } from "../../components/review/review-list-item.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { AppShell, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
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
import { loadViewerReviews, type ReviewListEntry } from "../../lib/review-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Hardware Reviews",
  description: "All active and completed hardware reviews and sign-offs across every supported CAD format.",
};

export const dynamic = "force-dynamic";

const columns: readonly DataColumn<ReviewListEntry>[] = [
  {
    id: "decision",
    header: "Decision",
    cell: (review) => <StatusBadge value={review.decision} />,
  },
  {
    id: "review",
    header: "Review",
    rowHeader: true,
    cell: (review) => (
      <>
        <Link href={`/reviews/${review.id}`} className="text-primary hover:underline">
          {review.title}
        </Link>
        <div className="mt-0.5 text-meta text-muted-foreground">
          {review.repositoryName}
          {review.pullRequestNumber === undefined ? "" : ` · PR #${review.pullRequestNumber}`}
        </div>
      </>
    ),
  },
  { id: "status", header: "Status", cell: (review) => <StatusBadge value={review.status} /> },
  { id: "author", header: "Opened by", cell: (review) => review.createdBy },
  {
    id: "updated",
    header: "Updated",
    align: "end",
    cell: (review) =>
      review.updatedAt ? (
        <time dateTime={review.updatedAt} className="text-muted-foreground tabular-nums">
          {review.updatedAt.replace("T", " ").slice(0, 16)}
        </time>
      ) : (
        "—"
      ),
  },
];

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

function NoReviews() {
  return (
    <Panel title="No Reviews">
      <EmptyState title="No hardware reviews found">
        <p>
          Publish a review via GitHub Action or CLI: <code>boardreadyops review publish</code>
        </p>
      </EmptyState>
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
          <Panel title="Sign in required">
            <EmptyState title="Reviews are scoped to your installations">
              <p>Sign in with GitHub so BoardReadyOps knows which repositories you can see.</p>
            </EmptyState>
          </Panel>
        </main>
      </AppShell>
    );
  }

  const total = listing.reviews.length;
  const awaiting = listing.reviews.filter((review) => review.decision === "pending").length;
  const facets = reviewListFacets(listing.reviews);
  const filtered = hasActiveReviewFilter(filters);

  // The bundled demo reviews carry full finding detail, so they keep the richer card; database
  // rows only have what the listing query selects, which is a table's worth. Both go through the
  // same filter so the two shapes cannot diverge in what a filter means.
  let reviewsBody = <NoReviews />;
  let shown = 0;
  if (listing.state === "fixtures") {
    const visible = applyReviewListFilters(listing.reviews, filters);
    shown = visible.length;
    if (visible.length > 0) {
      reviewsBody = (
        <div className="grid grid-cols-1 gap-4">
          {visible.map((review) => (
            <ReviewListItem key={review.id} review={review} context="registry" />
          ))}
        </div>
      );
    } else if (total > 0) {
      reviewsBody = <NoMatchingReviews />;
    }
  } else {
    const visible = applyReviewListFilters(listing.reviews, filters);
    shown = visible.length;
    if (visible.length > 0) {
      reviewsBody = (
        <DataTable
          caption="Hardware reviews across every visible repository"
          columns={columns}
          rows={visible}
          rowKey={(review) => review.id}
          empty={<NoReviews />}
        />
      );
    } else if (total > 0) {
      reviewsBody = <NoMatchingReviews />;
    }
  }

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Reviews" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Hardware Reviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Decision-ready hardware design reviews across all repositories and pull requests.
          </p>
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
      </main>
    </AppShell>
  );
}
