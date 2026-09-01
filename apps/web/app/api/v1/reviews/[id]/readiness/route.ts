import { ReviewStore } from "@boardreadyops/db";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../../../lib/api-auth.js";
import { computeReviewReadiness } from "../../../../../../lib/review-readiness.js";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const ctx = await resolveRepositoryApiContext(auth, request);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

  const { id: reviewId } = await context.params;
  try {
    const reviewStore = new ReviewStore(executor);
    const review = await reviewStore.getReviewById(repositoryId, reviewId);
    if (!review) {
      return Response.json({ ok: false, error: "Review not found" }, { status: 404 });
    }

    const revisions = await reviewStore.listReviewRevisions(repositoryId, reviewId);
    const currentRevision = revisions.find((revision) => revision.id === review.currentRevisionId) ?? revisions[0];
    if (!currentRevision) {
      return Response.json({ ok: false, error: "Review has no revisions" }, { status: 409 });
    }

    const { readiness, effectivePolicy } = await computeReviewReadiness({
      executor,
      repositoryId,
      reviewId,
      headRunId: review.headRunId,
      headEvidenceDigest: currentRevision.evidenceDigest,
      tenantId: auth.actorId,
    });

    return Response.json({ ok: true, readiness, effectivePolicy });
  } finally {
    await executor.close();
  }
}
