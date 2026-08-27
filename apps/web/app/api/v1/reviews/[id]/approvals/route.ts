import { ReviewApprovalStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../../lib/cloud-runtime-config.js";

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

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewApprovalStore(executor);
    const approvals = await store.listApprovalsForReview(reviewId);
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = recordApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid approval payload" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewApprovalStore(executor);
    const approval = await store.recordApproval({
      repositoryId: auth.repositoryId ?? "default-repo",
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
    const message = error instanceof Error ? error.message : "Failed to record approval";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await executor.close();
  }
}
