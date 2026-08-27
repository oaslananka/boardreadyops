import { ReviewPolicyStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const updatePolicySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(1000).nullable().optional(),
  requiredChecklist: z.array(z.string().min(1).max(128)).max(20).optional(),
  requiredRoles: z.array(z.string().min(1).max(64)).max(10).optional(),
  severityGate: z.enum(["error", "high", "medium"]).nullable().optional(),
  requireEvidencePack: z.boolean().optional(),
  requireExternalReview: z.boolean().optional(),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const { id } = await props.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updatePolicySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid policy payload", issues: parsed.error.issues }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewPolicyStore(executor);
    const tenantId = viewer.session.login; // simplified tenant mapping
    const existing = await store.getPolicyById(id);
    if (!existing || existing.tenantId !== tenantId) {
      return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
    }
    const updated = await store.updatePolicy(id, parsed.data);
    return Response.json({ ok: true, policy: updated });
  } finally {
    await executor.close();
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const { id } = await props.params;

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewPolicyStore(executor);
    const tenantId = viewer.session.login; // simplified tenant mapping
    const existing = await store.getPolicyById(id);
    if (!existing || existing.tenantId !== tenantId) {
      return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
    }
    const deleted = await store.deletePolicy(id);
    return Response.json({ ok: deleted });
  } finally {
    await executor.close();
  }
}
