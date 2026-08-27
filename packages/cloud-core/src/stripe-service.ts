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
