import { ReviewApprovalStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveReviewApiContext } from "../../../../../../lib/api-auth.js";

export const runtime = "nodejs";

const recordApprovalSchema = z.object({
  revisionId: z.string().min(1),
  evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.enum(["approved", "changes_requested", "dismissed"]),
  reason: z.string().optional(),
  isBreakGlass: z.boolean().optional(),
});

export async function GET(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id: reviewId } = await props.params;

  const ctx = await resolveReviewApiContext(reviewId, auth);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

  try {
    const store = new ReviewApprovalStore(executor);
    const approvals = await store.listApprovalsForReview(reviewId, repositoryId);
    return Response.json({ ok: true, approvals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load approvals";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id: reviewId } = await props.params;

  const ctx = await resolveReviewApiContext(reviewId, auth);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, currentRevisionId, executor } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await executor.close();
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = recordApprovalSchema.safeParse(body);
  if (!parsed.success) {
    await executor.close();
    return Response.json(
      { ok: false, error: "Invalid approval payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // 1. Verify revision is current active revision
  if (currentRevisionId && parsed.data.revisionId !== currentRevisionId) {
    await executor.close();
    return Response.json(
      { ok: false, error: "Submitted revision is not the current active review revision" },
      { status: 409 },
    );
  }

  try {
    // 2. Authoritatively verify revision exists and evidenceDigest matches
    const revisionResult = await executor.query(
      `SELECT id, evidence_digest FROM review_revisions WHERE id = $1 AND review_id = $2 LIMIT 1`,
      [parsed.data.revisionId, reviewId],
    );
    const revisionRows = (revisionResult as { rows?: { id: string; evidence_digest: string }[] }).rows ?? [];
    const revision = revisionRows[0];
    if (!revision) {
      return Response.json({ ok: false, error: "Review revision not found" }, { status: 404 });
    }

    if (revision.evidence_digest !== parsed.data.evidenceDigest) {
      return Response.json(
        { ok: false, error: "Evidence digest does not match the active review revision" },
        { status: 409 },
      );
    }

    // 3. Atomically persist approval and synchronize review decision in a single CTE
    const store = new ReviewApprovalStore(executor);
    const approval = await store.recordApprovalAndTransitionDecision({
      repositoryId,
      reviewId,
      revisionId: parsed.data.revisionId,
      evidenceDigest: parsed.data.evidenceDigest,
      approverId: auth.actorId,
      status: parsed.data.status,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      ...(parsed.data.isBreakGlass !== undefined ? { isBreakGlass: parsed.data.isBreakGlass } : {}),
    });

    return Response.json({ ok: true, approval }, { status: 201 });
  } catch (error) {
    const isConflict =
      (error && typeof error === "object" && "isConflict" in error && Boolean(error.isConflict)) ||
      (error instanceof Error && error.message.includes("Conflicting approval"));
    const message = error instanceof Error ? error.message : "Failed to record approval";
    return Response.json({ ok: false, error: message }, { status: isConflict ? 409 : 500 });
  } finally {
    await executor.close();
  }
}
