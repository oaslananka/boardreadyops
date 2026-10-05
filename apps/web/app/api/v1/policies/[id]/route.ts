import type { ReviewPolicyRecord, ReviewPolicyStore } from "@boardreadyops/db";
import { z } from "zod";
import { requirePolicyViewer, withPolicyStore } from "../../../../../lib/policy-route-context.js";

export const runtime = "nodejs";

async function getOwnedPolicyOrError(
  store: ReviewPolicyStore,
  id: string,
  tenantId: string,
): Promise<ReviewPolicyRecord | Response> {
  const existing = await store.getPolicyById(id);
  if (existing?.tenantId !== tenantId) {
    return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
  }
  return existing;
}

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
  const viewer = await requirePolicyViewer();
  if (viewer instanceof Response) return viewer;

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

  return withPolicyStore(async (store) => {
    const owned = await getOwnedPolicyOrError(store, id, viewer.login);
    if (owned instanceof Response) return owned;
    const updated = await store.updatePolicy(id, parsed.data, {
      githubUserId: viewer.userId,
      login: viewer.login,
    });
    return Response.json({ ok: true, policy: updated });
  });
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const viewer = await requirePolicyViewer();
  if (viewer instanceof Response) return viewer;

  const { id } = await props.params;

  return withPolicyStore(async (store) => {
    const owned = await getOwnedPolicyOrError(store, id, viewer.login);
    if (owned instanceof Response) return owned;
    const deleted = await store.deletePolicy(id, {
      githubUserId: viewer.userId,
      login: viewer.login,
    });
    return Response.json({ ok: deleted });
  });
}
