import { ReviewApprovalStore } from "@boardreadyops/db";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest, resolveReviewApiContext } from "../../../../../../lib/api-auth.js";
import { computeReviewReadiness } from "../../../../../../lib/review-readiness.js";

export const runtime = "nodejs";

const recordApprovalSchema = z.object({
  revisionId: z.string().min(1),
  evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.enum(["approved", "changes_requested", "dismissed"]),
  reason: z.string().optional(),
  isBreakGlass: z.boolean().optional(),
});

type RecordApprovalInput = z.infer<typeof recordApprovalSchema>;

async function parseApprovalPayload(
  request: Request,
): Promise<{ ok: true; data: RecordApprovalInput } | { ok: false; error: string; status: number }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }

  const parsed = recordApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Invalid approval payload", status: 400 };
  }

  return { ok: true, data: parsed.data };
}

async function verifyRevisionDigest(
  executor: PgQueryExecutor,
  revisionId: string,
  reviewId: string,
  expectedDigest: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const revisionResult = await executor.query(
    `SELECT id, evidence_digest FROM review_revisions WHERE id = $1 AND review_id = $2 LIMIT 1`,
    [revisionId, reviewId],
  );
  const revisionRows = (revisionResult as { rows?: { id: string; evidence_digest: string }[] }).rows ?? [];
  const revision = revisionRows[0];
  if (!revision) {
    return { ok: false, error: "Review revision not found", status: 404 };
  }

  if (revision.evidence_digest !== expectedDigest) {
    return { ok: false, error: "Evidence digest does not match the active review revision", status: 409 };
  }

  return { ok: true };
}

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
  const { repositoryId, headRunId, currentRevisionId, executor } = ctx;

  try {
    const payload = await parseApprovalPayload(request);
    if (!payload.ok) {
      return Response.json({ ok: false, error: payload.error }, { status: payload.status });
    }

    if (currentRevisionId && payload.data.revisionId !== currentRevisionId) {
      return Response.json(
        { ok: false, error: "Submitted revision is not the current active review revision" },
        { status: 409 },
      );
    }

    const verification = await verifyRevisionDigest(
      executor,
      payload.data.revisionId,
      reviewId,
      payload.data.evidenceDigest,
    );
    if (!verification.ok) {
      return Response.json({ ok: false, error: verification.error }, { status: verification.status });
    }

    // The effective policy's severity gate and required-checklist blockers must
    // actually stop an approval, not just be summarized in the UI's readiness
    // display -- a policy configured to block on e.g. "high" severity was
    // previously only advisory here. isBreakGlass is the sanctioned, already-
    // audited (is_break_glass column, ChecklistApprovalsTab surfaces it) bypass
    // for this gate; it is not a new escape hatch.
    //
    // Deliberately excluded from this gate:
    // - "missing_approval": evaluated before this approval is recorded, so it
    //   would always report itself as missing -- it's what this action fulfills.
    // - "missing_required_approver_role": collectRoleBlockers() requires an
    //   approverId -> roles map that nothing in this codebase populates yet
    //   (evaluateReviewReadiness is never called with `approverRoles`), so this
    //   blocker type currently fires (and never clears) whenever a policy sets
    //   requiredRoles at all, regardless of who approves. Enforcing it here
    //   would deadlock every review under such a policy, not fix bypass -- the
    //   fix for that is the role-mapping feature itself, out of scope here.
    const enforcedBlockerTypes = new Set([
      "unresolved_finding",
      "incomplete_checklist",
      "missing_required_checklist_item",
    ]);
    if (payload.data.status === "approved" && !payload.data.isBreakGlass) {
      const { readiness } = await computeReviewReadiness({
        executor,
        repositoryId,
        reviewId,
        headRunId,
        headEvidenceDigest: payload.data.evidenceDigest,
        tenantId: auth.actorId,
      });
      const gatingBlockers = readiness.blockers.filter((blocker) => enforcedBlockerTypes.has(blocker.type));
      if (gatingBlockers.length > 0) {
        return Response.json(
          {
            ok: false,
            error: "Review does not meet the effective policy's readiness requirements",
            blockers: gatingBlockers,
          },
          { status: 409 },
        );
      }
    }

    const store = new ReviewApprovalStore(executor);
    const approval = await store.recordApprovalAndTransitionDecision({
      repositoryId,
      reviewId,
      revisionId: payload.data.revisionId,
      evidenceDigest: payload.data.evidenceDigest,
      approverId: auth.actorId,
      status: payload.data.status,
      ...(payload.data.reason ? { reason: payload.data.reason } : {}),
      ...(payload.data.isBreakGlass !== undefined ? { isBreakGlass: payload.data.isBreakGlass } : {}),
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
