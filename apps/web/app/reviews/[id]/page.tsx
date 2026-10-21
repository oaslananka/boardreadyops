import { notFound } from "next/navigation";
import { ReviewView } from "../../../components/review/review-view.js";
import { AppShell } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { loadServerReview } from "../../../lib/server-review-loader.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await viewerAuthorization();
  const review = await loadServerReview(id, viewer.session);
  return {
    title: review
      ? `${review.title} · ${review.pullRequestNumber > 0 ? `PR #${review.pullRequestNumber}` : "Manual review"}`
      : "Review Details",
    description: "Hardware Review & Evidence OS review workspace.",
  };
}

export default async function ReviewDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const viewer = await viewerAuthorization();
  const review = await loadServerReview(id, viewer.session);

  if (!review) {
    return notFound();
  }

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/reviews", label: "Reviews" },
        { label: review.pullRequestNumber > 0 ? `PR #${review.pullRequestNumber}` : "Manual review" },
      ]}
    >
      <main
        className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-6 sm:px-6 sm:py-8"
        id="main-content"
      >
        <ReviewView initialReview={review} viewerLogin={viewer.session?.login} />
      </main>
    </AppShell>
  );
}
