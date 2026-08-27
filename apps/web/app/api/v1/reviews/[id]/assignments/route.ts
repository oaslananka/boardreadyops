import { ReviewCollaborationStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../../lib/cloud-runtime-config.js";

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

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
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

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewCollaborationStore(executor);
    const assignment = await store.assignFinding({
      repositoryId: auth.repositoryId ?? "default-repo",
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

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
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
