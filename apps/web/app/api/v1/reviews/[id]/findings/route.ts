import { computeFindingDiff, type InputFinding } from "@boardreadyops/cloud-core";
import { ReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateApiRequest } from "../../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id: reviewId } = await context.params;
  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");
  if (!repositoryId) {
    return Response.json({ ok: false, error: "repositoryId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
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
