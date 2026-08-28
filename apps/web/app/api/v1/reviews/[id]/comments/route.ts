import { ReviewCommentStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveReviewApiContext } from "../../../../../../lib/api-auth.js";

export const runtime = "nodejs";

const createCommentSchema = z.object({
  content: z.string().min(1).max(10000),
  parentId: z.string().optional(),
  findingFingerprint: z.string().optional(),
  evidenceAnchor: z.string().optional(),
  authorType: z.enum(["internal", "guest"]).optional(),
});

const updateCommentSchema = z.object({
  commentId: z.string().min(1),
  status: z.enum(["open", "resolved", "stale"]),
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
    const store = new ReviewCommentStore(executor);
    const comments = await store.listCommentsForReview(reviewId);
    return Response.json({ ok: true, comments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load comments";
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

  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid comment payload" }, { status: 400 });
  }

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { repositoryId, executor } = reviewContext;
  try {
    const store = new ReviewCommentStore(executor);
    const comment = await store.createComment({
      repositoryId,
      reviewId,
      authorId: auth.actorId,
      content: parsed.data.content,
      ...(parsed.data.parentId ? { parentId: parsed.data.parentId } : {}),
      ...(parsed.data.findingFingerprint ? { findingFingerprint: parsed.data.findingFingerprint } : {}),
      ...(parsed.data.evidenceAnchor ? { evidenceAnchor: parsed.data.evidenceAnchor } : {}),
      ...(parsed.data.authorType ? { authorType: parsed.data.authorType } : {}),
    });

    return Response.json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create comment";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
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

  const parsed = updateCommentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid update comment payload" }, { status: 400 });
  }

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { executor } = reviewContext;
  try {
    const store = new ReviewCommentStore(executor);
    const updated = await store.updateCommentStatus(parsed.data.commentId, parsed.data.status);
    if (!updated) {
      return Response.json({ ok: false, error: "Comment not found" }, { status: 404 });
    }
    return Response.json({ ok: true, comment: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update comment";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}
