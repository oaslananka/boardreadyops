import { ReviewCollaborationStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveReviewApiContext } from "../../../../../../lib/api-auth.js";

export const runtime = "nodejs";

const assignSchema = z.object({
  findingFingerprint: z.string().min(1),
  assignee: z.string().min(1),
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
    const store = new ReviewCollaborationStore(executor);
    const assignments = await store.listAssignmentsForReview(reviewId);
    return Response.json({ ok: true, assignments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load assignments";
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

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid assignment payload" }, { status: 400 });
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

    const store = new ReviewCollaborationStore(executor);
    const assignment = await store.assignFinding({
      repositoryId,
      reviewId,
      findingFingerprint: parsed.data.findingFingerprint,
      assignee: parsed.data.assignee,
      assignedBy: auth.actorId,
    });

    return Response.json({ ok: true, assignment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to assign finding";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
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

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid unassign payload" }, { status: 400 });
  }

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { executor } = reviewContext;
  try {
    const store = new ReviewCollaborationStore(executor);
    const unassigned = await store.unassignFinding(reviewId, parsed.data.findingFingerprint, parsed.data.assignee);

    return Response.json({ ok: true, unassigned });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to unassign finding";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}
