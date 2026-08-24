/**
 * Plan entitlements.
 *
 * `plan_tier` has existed on `installations` since the first migration as an unread string
 * column. This module gives it meaning: what each tier allows, and one place that answers
 * whether an action is permitted.
 *
 * Deliberately payment-provider agnostic. Nothing here knows about Stripe or any other
 * processor; a billing integration's only job is to keep `planTier` current. That keeps the
 * limits testable without a payment account and keeps a provider swap from touching policy.
 *
 * The metered unit is the watched board, not the seat. A hardware team is small while each
 * board is a five-figure asset whose respin costs weeks, so per-board tracks the value the
 * customer actually gets and grows as they grow.
 */

export const planTiers = ["free", "pro", "team"] as const;
export type PlanTier = (typeof planTiers)[number];

export type PlanLimits = {
  /** Boards that may be kept under continuous supply watch. */
  watchedBoards: number;
  /** How far back release evidence stays queryable, in days. `null` means indefinitely. */
  evidenceRetentionDays: number | null;
  /** Whether scheduled supply watch runs at all for this tier. */
  supplyWatch: boolean;
  /** Whether a permissioned evidence link can be shared outside the installation. */
  handoffLinks: boolean;
};

const limits: Record<PlanTier, PlanLimits> = {
  free: { watchedBoards: 1, evidenceRetentionDays: 30, supplyWatch: false, handoffLinks: false },
  pro: { watchedBoards: 10, evidenceRetentionDays: 365, supplyWatch: true, handoffLinks: true },
  team: { watchedBoards: 100, evidenceRetentionDays: null, supplyWatch: true, handoffLinks: true },
};

/**
 * Resolves a stored tier string.
 *
 * An unrecognised or missing value resolves to `free` rather than throwing. A row written by
 * a newer deployment, or corrupted by hand, must not take the control plane down; degrading
 * to the least privileged tier fails safe.
 */
export function planTierOf(value: string | null | undefined): PlanTier {
  const normalized = value?.trim().toLowerCase();
  return (planTiers as readonly string[]).includes(normalized ?? "") ? (normalized as PlanTier) : "free";
}

export function planLimits(tier: PlanTier): PlanLimits {
  return limits[tier];
}

export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; reason: string; limit: number; current: number; requiredTier: PlanTier | undefined };

/** The cheapest tier that permits the requested number of watched boards, if any does. */
function tierAllowingBoards(count: number): PlanTier | undefined {
  return planTiers.find((tier) => limits[tier].watchedBoards >= count);
}

/**
 * Decides whether another board may be enrolled in supply watch.
 *
 * Enrolment is the metered action rather than board discovery: a repository is free to
 * contain as many boards as it likes, and evidence is still recorded for all of them. What
 * the plan meters is the ongoing service of watching them.
 */
export function canWatchAnotherBoard(tier: PlanTier, currentWatchedBoards: number): EntitlementDecision {
  const limit = limits[tier].watchedBoards;
  if (currentWatchedBoards < limit) return { allowed: true };
  const next = tierAllowingBoards(currentWatchedBoards + 1);
  return {
    allowed: false,
    reason:
      next === undefined
        ? `Watching ${currentWatchedBoards + 1} boards is beyond every published plan. Contact us to size a plan.`
        : `The ${tier} plan watches ${limit} board${limit === 1 ? "" : "s"}. Upgrade to ${next} to watch more.`,
    limit,
    current: currentWatchedBoards,
    requiredTier: next,
  };
}

export function supplyWatchEnabled(tier: PlanTier): boolean {
  return limits[tier].supplyWatch;
}

export function handoffLinksEnabled(tier: PlanTier): boolean {
  return limits[tier].handoffLinks;
}

/**
 * The cutoff before which evidence is no longer served for this tier.
 *
 * Returns `undefined` when the tier retains indefinitely. Retention bounds what is *served*;
 * deleting stored evidence is a separate, deliberate operation, so a lapsed subscription
 * hides history rather than destroying a customer's compliance record.
 */
export function evidenceVisibleFrom(tier: PlanTier, now: Date): Date | undefined {
  const days = limits[tier].evidenceRetentionDays;
  if (days === null) return undefined;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
