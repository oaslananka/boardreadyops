import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripePriceConfig {
  teamMonthlyPriceId: string;
  teamYearlyPriceId: string;
  businessMonthlyPriceId: string;
  businessYearlyPriceId: string;
}

export function getStripePriceConfig(): StripePriceConfig | null {
  const cfg = {
    teamMonthlyPriceId: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID ?? "",
    teamYearlyPriceId: process.env.STRIPE_TEAM_YEARLY_PRICE_ID ?? "",
    businessMonthlyPriceId: process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID ?? "",
    businessYearlyPriceId: process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID ?? "",
  };
  if (!cfg.teamMonthlyPriceId || !cfg.businessMonthlyPriceId) return null;
  return cfg;
}

export function verifyStripeWebhookSignature(input: {
  rawBody: string | Buffer;
  signatureHeader: string | null | undefined;
  webhookSecret: string;
  toleranceSeconds?: number;
}): { verified: boolean; error?: string } {
  if (!input.signatureHeader) return { verified: false, error: "Missing Stripe-Signature header" };
  const raw = typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8");
  // Stripe header format: t=timestamp,v1=hmac,v0=...
  const parts = input.signatureHeader.split(",").reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return { verified: false, error: "Invalid signature header format" };
  const tolerance = input.toleranceSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  const tsNum = Number.parseInt(timestamp, 10);
  if (Number.isNaN(tsNum) || Math.abs(now - tsNum) > tolerance) {
    return { verified: false, error: "Timestamp outside tolerance window" };
  }
  const signedPayload = `${timestamp}.${raw}`;
  const expected = createHmac("sha256", input.webhookSecret).update(signedPayload, "utf8").digest("hex");
  try {
    const a = Buffer.from(v1, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return { verified: false, error: "Signature mismatch" };
    const equal = timingSafeEqual(a, b);
    return equal ? { verified: true } : { verified: false, error: "Signature mismatch" };
  } catch {
    return { verified: false, error: "Signature hex decode failed" };
  }
}

export function resolveTierFromPriceId(priceId: string, config: StripePriceConfig): "team" | "business" | null {
  if (priceId === config.teamMonthlyPriceId || priceId === config.teamYearlyPriceId) return "team";
  if (priceId === config.businessMonthlyPriceId || priceId === config.businessYearlyPriceId) return "business";
  return null;
}

export function resolveIntervalFromPriceId(priceId: string, config: StripePriceConfig): "month" | "year" | null {
  if (priceId === config.teamMonthlyPriceId || priceId === config.businessMonthlyPriceId) return "month";
  if (priceId === config.teamYearlyPriceId || priceId === config.businessYearlyPriceId) return "year";
  return null;
}

export const handledStripeEventTypes = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);
