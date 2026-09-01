import { z } from "zod";

export const billingTierSchema = z.enum(["free", "team", "business"]);
export type BillingTier = z.infer<typeof billingTierSchema>;

export const billingIntervalSchema = z.enum(["month", "year"]);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const billingCustomerSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  stripeCustomerId: z.string().min(1).nullable(),
  tier: billingTierSchema,
  status: z.enum(["active", "trialing", "past_due", "canceled", "incomplete"]),
  trialEndsAt: z.string().datetime().nullable(),
  graceEndsAt: z.string().datetime().nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BillingCustomer = z.infer<typeof billingCustomerSchema>;

export const billingSubscriptionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  stripeSubscriptionId: z.string().min(1),
  stripePriceId: z.string().min(1),
  tier: billingTierSchema,
  interval: billingIntervalSchema,
  status: z.string().min(1),
  quantity: z.number().int().positive(),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;

export const billingEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1).nullable(),
  type: z.string().min(1),
  provider: z.string().min(1).default("stripe"),
  stripeEventId: z.string().min(1).nullable().optional(),
  deliveryId: z.string().min(1).nullable().optional(),
  payload: z.unknown(),
  processedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type BillingEvent = z.infer<typeof billingEventSchema>;

export const marketplaceActions = [
  "purchased",
  "cancelled",
  "pending_change",
  "pending_change_cancelled",
  "changed",
] as const;
export type MarketplaceAction = (typeof marketplaceActions)[number];

export const marketplacePurchaseMetadataSchema = z.object({
  deliveryId: z.string().min(1),
  action: z.string().min(1),
  accountLogin: z.string().min(1),
  accountId: z.number().int().optional(),
  accountType: z.string().optional(),
  planId: z.number().int().optional(),
  planName: z.string().optional(),
  priceModel: z.string().optional(),
  billingCycle: z.string().optional(),
  effectiveDate: z.string().optional(),
  onFreeTrial: z.boolean().optional(),
  freeTrialEndsOn: z.string().nullable().optional(),
});
export type MarketplacePurchaseMetadata = z.infer<typeof marketplacePurchaseMetadataSchema>;

export const billingActivitySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  actorType: z.enum(["internal", "guest", "system"]),
  action: z.enum(["policy_update", "disposition", "release_create", "workspace_manage", "comment", "approval"]),
  createdAt: z.string().datetime(),
});
export type BillingActivity = z.infer<typeof billingActivitySchema>;

export const checkoutRequestSchema = z.object({
  tier: z.enum(["team", "business"]),
  interval: billingIntervalSchema.default("month"),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const portalRequestSchema = z.object({
  returnUrl: z.string().url().optional(),
});
export type PortalRequest = z.infer<typeof portalRequestSchema>;

export const webhookEventTypes = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

export function isActiveContributorActivity(action: string, actorType: string): boolean {
  if (actorType !== "internal") return false;
  return ["policy_update", "disposition", "release_create", "workspace_manage"].includes(action);
}

export const billingPriceConfigSchema = z.object({
  teamMonthlyPriceId: z.string().min(1),
  teamYearlyPriceId: z.string().min(1),
  businessMonthlyPriceId: z.string().min(1),
  businessYearlyPriceId: z.string().min(1),
});
export type BillingPriceConfig = z.infer<typeof billingPriceConfigSchema>;
