import { computeFindingDiff, type InputFinding } from "@boardreadyops/cloud-core";
import { ReviewStore } from "@boardreadyops/db";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../../../lib/api-auth.js";

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

    const headFindingRows = await store.getFindingsForRun(repositoryId, review.headRunId);
    const headFindings: InputFinding[] = headFindingRows.map((r) => ({
      ruleId: r.rule_id,
      severity: r.severity,
      message: r.message,
      ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}),
      ...(r.path !== null ? { path: r.path } : {}),
      ...(r.kind !== null ? { kind: r.kind } : {}),
    }));

    let baseFindings: InputFinding[] = [];
    if (review.baseRunId) {
      const baseFindingRows = await store.getFindingsForRun(repositoryId, review.baseRunId);
      baseFindings = baseFindingRows.map((r) => ({
        ruleId: r.rule_id,
        severity: r.severity,
        message: r.message,
        ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}),
        ...(r.path !== null ? { path: r.path } : {}),
        ...(r.kind !== null ? { kind: r.kind } : {}),
      }));
    }

    const diff = computeFindingDiff(baseFindings, headFindings);

    return Response.json({
      ok: true,
      reviewId: review.id,
      baseRunId: review.baseRunId ?? null,
      headRunId: review.headRunId,
      diff,
    });
  } finally {
    await executor.close();
  }
}
