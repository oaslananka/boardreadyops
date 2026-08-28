import { findingDispositions } from "@boardreadyops/contracts";
import { FindingDecisionStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveReviewApiContext } from "../../../../../../lib/api-auth.js";

export const runtime = "nodejs";

const recordDecisionSchema = z
  .object({
    findingFingerprint: z.string().min(1),
    disposition: z.enum(findingDispositions),
    reason: z.string().min(1),
    owner: z.string().min(1),
    expiresAt: z.string().datetime().optional().nullable(),
    evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .refine((data) => data.disposition !== "accepted_risk" || data.reason.trim().length >= 20, {
    message: "Accepted risk disposition requires a justification reason of at least 20 characters",
    path: ["reason"],
  });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id: reviewId } = await props.params;

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { executor } = reviewContext;
  try {
    const store = new FindingDecisionStore(executor);
    const decisions = await store.listDecisionsForReview(reviewId);
    return Response.json({ ok: true, decisions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load decisions";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = recordDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision payload" },
      { status: 400 },
    );
  }

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { repositoryId, headRunId, executor } = reviewContext;
  try {
    const findingCheck = await executor.query(
      `SELECT 1 FROM findings WHERE run_id = $1 AND (fingerprint = $2 OR id = $2) LIMIT 1`,
      [headRunId, parsed.data.findingFingerprint],
    );
    const findingRows = (findingCheck as { rows?: unknown[] }).rows ?? [];
    if (findingRows.length === 0) {
      return Response.json({ ok: false, error: "Finding not found in review run" }, { status: 404 });
    }

    const store = new FindingDecisionStore(executor);
    const decision = await store.recordDecision({
      repositoryId,
      reviewId,
      findingFingerprint: parsed.data.findingFingerprint,
      disposition: parsed.data.disposition,
      reason: parsed.data.reason,
      owner: parsed.data.owner,
      expiresAt: parsed.data.expiresAt ?? null,
      evidenceDigest: parsed.data.evidenceDigest,
      actorId: auth.actorId,
    });

    return Response.json({ ok: true, decision }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record decision";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}
