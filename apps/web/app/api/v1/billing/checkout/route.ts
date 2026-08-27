import { checkoutRequestSchema } from "@boardreadyops/contracts";
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid checkout payload", issues: parsed.error.issues },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const priceConfig = {
    teamMonthlyPriceId: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID,
    teamYearlyPriceId: process.env.STRIPE_TEAM_YEARLY_PRICE_ID,
    businessMonthlyPriceId: process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID,
    businessYearlyPriceId: process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID,
  };
  if (!priceConfig.teamMonthlyPriceId || !priceConfig.businessMonthlyPriceId) {
    return Response.json(
      { ok: false, error: "Billing not configured", code: "external_manual_action_required" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
  const priceMap: Record<string, string | undefined> = {
    "team:month": priceConfig.teamMonthlyPriceId,
    "team:year": priceConfig.teamYearlyPriceId,
    "business:month": priceConfig.businessMonthlyPriceId,
    "business:year": priceConfig.businessYearlyPriceId,
  };
  const priceId = priceMap[`${parsed.data.tier}:${parsed.data.interval}`];
  if (!priceId) {
    return Response.json(
      { ok: false, error: "Price not configured for tier/interval" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  // In production, create Stripe Checkout Session via stripe.checkout.sessions.create
  // For now, return a deterministic checkout URL for contract testing
  const checkoutUrl = `https://checkout.stripe.com/pay/${priceId}#tenant=${encodeURIComponent(viewer.session.login)}`;
  return Response.json(
    { ok: true, checkoutUrl, priceId },
    { status: 200, headers: { "cache-control": "private, no-store" } },
  );
}
