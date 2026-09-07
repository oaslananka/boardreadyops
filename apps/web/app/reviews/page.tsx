import Link from "next/link";
import { ReviewListItem } from "../../components/review/review-list-item.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { AppShell, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";
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

export default async function ReviewsListPage() {
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

  // The bundled demo reviews carry full finding detail, so they keep the richer card; database
  // rows only have what the listing query selects, which is a table's worth.
  let reviewsBody = <NoReviews />;
  if (total > 0 && listing.state === "fixtures") {
    reviewsBody = (
      <div className="grid grid-cols-1 gap-4">
        {listing.reviews.map((review) => (
          <ReviewListItem key={review.id} review={review} context="registry" />
        ))}
      </div>
    );
  } else if (total > 0) {
    reviewsBody = (
      <DataTable
        caption="Hardware reviews across every visible repository"
        columns={columns}
        rows={listing.reviews}
        rowKey={(review) => review.id}
        empty={<NoReviews />}
      />
    );
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

        <section
          className="rounded-md border border-border bg-card px-4 py-3 text-sm"
          aria-label="Review registry summary"
        >
          Showing <strong>{total}</strong> review{total === 1 ? "" : "s"} (<strong>{awaiting}</strong> awaiting a
          decision)
        </section>

        {reviewsBody}
      </main>
    </AppShell>
  );
}
