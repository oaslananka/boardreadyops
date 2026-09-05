import { notFound } from "next/navigation";
import { ReviewView } from "../../../components/review/review-view.js";
import { AppShell, Breadcrumbs } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { loadServerReview } from "../../../lib/server-review-loader.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await viewerAuthorization();
  const review = await loadServerReview(id, viewer.session);
  return {
    title: review ? `${review.title} · Review #${review.pullRequestNumber}` : "Review Details",
    description: "Hardware Review & Evidence OS review workspace.",
  };
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await viewerAuthorization();
  const review = await loadServerReview(id, viewer.session);

  if (!review) {
    return notFound();
  }

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/reviews", label: "Reviews" },
            { label: `PR #${review.pullRequestNumber}` },
          ]}
        />
        <ReviewView initialReview={review} viewerLogin={viewer.session?.login} />
      </main>
    </AppShell>
  );
}
