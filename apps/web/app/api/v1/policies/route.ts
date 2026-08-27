import { ReviewPolicyStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const createPolicySchema = z.object({
  scope: z.enum(["organization", "team", "repository"]),
  scopeId: z.string().min(1).optional(),
  name: z.string().min(1).max(128),
  description: z.string().max(1000).optional(),
  requiredChecklist: z.array(z.string().min(1).max(128)).max(20).optional(),
  requiredRoles: z.array(z.string().min(1).max(64)).max(10).optional(),
  severityGate: z.enum(["error", "high", "medium"]).optional(),
  requireEvidencePack: z.boolean().optional(),
  requireExternalReview: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewPolicyStore(executor);
    const tenantId = viewer.session.login; // simplified tenant mapping
    const policies = await store.listPolicies(tenantId);
    return Response.json({ ok: true, policies });
  } finally {
    await executor.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPolicySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid policy payload", issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.scope !== "organization" && !parsed.data.scopeId) {
    return Response.json({ ok: false, error: "scopeId is required for team/repository scope" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewPolicyStore(executor);
    const tenantId = viewer.session.login; // simplified tenant mapping
    const policy = await store.createPolicy({
      tenantId,
      scope: parsed.data.scope,
      scopeId: parsed.data.scopeId ?? null,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      requiredChecklist: parsed.data.requiredChecklist ?? [],
      requiredRoles: parsed.data.requiredRoles ?? [],
      severityGate: parsed.data.severityGate ?? null,
      requireEvidencePack: parsed.data.requireEvidencePack ?? false,
      requireExternalReview: parsed.data.requireExternalReview ?? false,
    });
    return Response.json({ ok: true, policy }, { status: 201 });
  } finally {
    await executor.close();
  }
}
