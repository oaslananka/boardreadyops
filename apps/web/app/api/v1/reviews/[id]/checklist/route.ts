import { ReviewApprovalStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveReviewApiContext } from "../../../../../../lib/api-auth.js";

export const runtime = "nodejs";

const addItemSchema = z.object({
  title: z.string().min(1).max(256),
});

const updateItemSchema = z.object({
  id: z.string().min(1),
  completed: z.boolean(),
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
    const store = new ReviewApprovalStore(executor);
    const items = await store.listChecklistItems(reviewId);
    return Response.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load checklist items";
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

  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid checklist item payload" }, { status: 400 });
  }

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { repositoryId, executor } = reviewContext;
  try {
    const store = new ReviewApprovalStore(executor);
    const item = await store.addChecklistItem({
      repositoryId,
      reviewId,
      title: parsed.data.title,
    });

    return Response.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add checklist item";
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

  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid update checklist item payload" }, { status: 400 });
  }

  const reviewContext = await resolveReviewApiContext(reviewId, auth);
  if (reviewContext instanceof Response) {
    return reviewContext;
  }

  const { executor } = reviewContext;
  try {
    const store = new ReviewApprovalStore(executor);
    const updated = await store.updateChecklistItem(parsed.data.id, parsed.data.completed, auth.actorId);
    if (!updated) {
      return Response.json({ ok: false, error: "Checklist item not found" }, { status: 404 });
    }
    return Response.json({ ok: true, item: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update checklist item";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}
