import { requirePolicyViewer, withPolicyStore } from "../../../../../../lib/policy-route-context.js";

export const runtime = "nodejs";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const viewer = await requirePolicyViewer();
  if (viewer instanceof Response) return viewer;

  const { id } = await props.params;
  return withPolicyStore(async (store) => {
    const policy = await store.getPolicyById(id);
    if (policy && policy.tenantId !== viewer.login) {
      return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
    }

    const events = await store.listAuditEvents(viewer.login, id);
    if (!policy && events.length === 0) {
      return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
    }
    return Response.json({ ok: true, events });
  });
}
