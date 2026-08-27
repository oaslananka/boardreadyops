import { notFound } from "next/navigation";
import { ReviewView } from "../../../components/review/review-view.js";
import { AppShell, Breadcrumbs } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { DEMO_REVIEWS, getDemoReview } from "../../../lib/demo-data.js";
import { buildDemoSnapshots } from "../../../lib/demo-snapshots.js";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = getDemoReview(id);
  return {
    title: review ? `${review.title} · Review #${review.pullRequestNumber}` : "Review Details",
    description: "Hardware Review & Evidence OS review workspace.",
  };
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baseReview = getDemoReview(id) ?? DEMO_REVIEWS[0];

  if (!baseReview) {
    return notFound();
  }

  const review = {
    ...baseReview,
    headSnapshots: buildDemoSnapshots(baseReview.changedFiles, baseReview.findings),
  };

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="shell review-page-shell" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/reviews", label: "Reviews" },
            { label: `PR #${review.pullRequestNumber}` },
          ]}
        />
        <ReviewView initialReview={review} />
      </main>
    </AppShell>
  );
}
