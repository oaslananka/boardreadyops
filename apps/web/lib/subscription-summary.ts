import type { ViewerInstallation } from "./viewer-installations.js";

/**
 * The plan a viewer is actually on, resolved from their installations.
 *
 * `/settings/billing` previously hardcoded `"community"`, so a paying customer was told they were
 * on the free tier. Installations carry the authoritative `plan_tier` (billing-store mirrors both
 * Stripe subscriptions and GitHub Marketplace purchases onto it), and a viewer can belong to
 * several — so the highest tier wins and the summary names which account it came from, rather
 * than silently picking one.
 */

export type PlanTier = "community" | "team" | "business" | "pilot";

/** Order matters: it is what "highest tier wins" means. */
const tierRank: Record<PlanTier, number> = { community: 0, team: 1, business: 2, pilot: 3 };

/**
 * `installations.plan_tier` predates the tier rename in ADR-0014 and is written by two different
 * sources, so the stored value can be `free`, `team`, `business`, `pilot`, or something older.
 * Anything unrecognised reads as community: showing less entitlement than someone has is a
 * recoverable annoyance, showing more is a billing dispute.
 */
export function normalizePlanTier(value: string | undefined): PlanTier {
  switch (value?.trim().toLowerCase()) {
    case "team":
      return "team";
    case "business":
      return "business";
    case "pilot":
      return "pilot";
    default:
      return "community";
  }
}

export type SubscriptionSummary = {
  tier: PlanTier;
  /** The account whose plan won, so the page can say where the entitlement comes from. */
  accountLogin: string | undefined;
  /** True when more than one installation contributes a different tier. */
  mixed: boolean;
};

export function summarizeSubscription(installations: readonly ViewerInstallation[]): SubscriptionSummary {
  let best: { tier: PlanTier; accountLogin: string } | undefined;
  const seen = new Set<PlanTier>();

  for (const installation of installations) {
    const tier = normalizePlanTier(installation.planTier);
    seen.add(tier);
    if (!best || tierRank[tier] > tierRank[best.tier]) {
      best = { tier, accountLogin: installation.accountLogin };
    }
  }

  return {
    tier: best?.tier ?? "community",
    accountLogin: best?.accountLogin,
    mixed: seen.size > 1,
  };
}
