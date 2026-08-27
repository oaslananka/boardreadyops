import { portalRequestSchema } from "@boardreadyops/contracts";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json(
      { ok: false, error: "authentication required" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as unknown;
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const parsed = portalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid portal payload", issues: parsed.error.issues },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json(
      { ok: false, error: "Billing not configured", code: "external_manual_action_required" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
  const returnUrl =
    parsed.data.returnUrl ?? `https://${request.headers.get("host") ?? "boardreadyops.example"}/settings/billing`;
  // In production, create Stripe Portal Session
  const portalUrl = `https://billing.stripe.com/session/portal_${viewer.session.login}?return=${encodeURIComponent(returnUrl)}`;
  return Response.json({ ok: true, portalUrl }, { status: 200, headers: { "cache-control": "private, no-store" } });
}
