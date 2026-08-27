import { ReviewStore } from "@boardreadyops/db";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../../lib/api-auth.js";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const ctx = resolveRepositoryApiContext(auth, request);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

  const { id: reviewId } = await context.params;
  try {
    const store = new ReviewStore(executor);
    const review = await store.getReviewById(repositoryId, reviewId);
    if (!review) {
      return Response.json({ ok: false, error: "Review not found" }, { status: 404 });
    }

    const revisions = await store.listReviewRevisions(repositoryId, reviewId);

    return Response.json({
      ok: true,
      review,
      revisions,
    });
  } finally {
    await executor.close();
  }
}
