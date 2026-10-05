import { z } from "zod";
import { requirePolicyViewer, withPolicyStore } from "../../../../lib/policy-route-context.js";

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
  const viewer = await requirePolicyViewer();
  if (viewer instanceof Response) return viewer;

  return withPolicyStore(async (store) => {
    const policies = await store.listPolicies(viewer.login);
    return Response.json({ ok: true, policies });
  });
}

export async function POST(request: Request): Promise<Response> {
  const viewer = await requirePolicyViewer();
  if (viewer instanceof Response) return viewer;

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

  return withPolicyStore(async (store) => {
    const policy = await store.createPolicy(
      {
        tenantId: viewer.login,
        scope: parsed.data.scope,
        scopeId: parsed.data.scopeId ?? null,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        requiredChecklist: parsed.data.requiredChecklist ?? [],
        requiredRoles: parsed.data.requiredRoles ?? [],
        severityGate: parsed.data.severityGate ?? null,
        requireEvidencePack: parsed.data.requireEvidencePack ?? false,
        requireExternalReview: parsed.data.requireExternalReview ?? false,
      },
      { githubUserId: viewer.userId, login: viewer.login },
    );
    return Response.json({ ok: true, policy }, { status: 201 });
  });
}
