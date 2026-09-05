import { getStripePriceConfig, priceIdForTier, type StripePriceConfig } from "@boardreadyops/cloud-core";
import { checkoutRequestSchema } from "@boardreadyops/contracts";
import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import type { BillingMode } from "../../../../../lib/billing-mode.js";
import { resolveBillingMode } from "../../../../../lib/billing-mode.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { retiredPaidBillingPost } from "../../../../../lib/marketplace-free-billing.js";
import { createStripeBillingClient, type StripeBillingClient } from "../../../../../lib/stripe-billing-client.js";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "private, no-store" } as const;

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: noStoreHeaders });
}

export interface CheckoutRouteDependencies {
  billingMode(): BillingMode;
  retiredMarketplaceFreeResponse(request: Request): Promise<Response>;
  authorizeViewer(): Promise<{ login: string } | undefined>;
  priceConfig(): StripePriceConfig | null;
  stripeSecretKey(): string | undefined;
  databaseUrl(): string | undefined;
  getExistingCustomer(tenantId: string, databaseUrl: string): Promise<{ stripeCustomerId: string | null } | null>;
  createBillingClient(secretKey: string): StripeBillingClient;
  appUrl(): string | undefined;
}

const defaultDependencies: CheckoutRouteDependencies = {
  billingMode: resolveBillingMode,
  retiredMarketplaceFreeResponse: retiredPaidBillingPost,
  async authorizeViewer() {
    const viewer = await viewerAuthorization();
    return viewer.session ? { login: viewer.session.login } : undefined;
  },
  priceConfig: getStripePriceConfig,
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY,
  databaseUrl: () => {
    const config = resolveCloudPersistenceConfiguration();
    return config.mode === "postgres" ? config.databaseUrl : undefined;
  },
  async getExistingCustomer(tenantId, databaseUrl) {
    const executor = createPgQueryExecutor({ connectionString: databaseUrl });
    try {
      return await new BillingStore(executor).getCustomer(tenantId);
    } finally {
      await executor.close();
    }
  },
  createBillingClient: createStripeBillingClient,
  appUrl: () => process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL,
};

/**
 * Opens a Stripe Checkout session for the signed-in viewer's tenant (their GitHub login, matching
 * the tenant identity `BillingStore.forecastContributors` already uses for the read-only
 * Marketplace billing page). Dark by default: `BILLING_MODE=marketplace_free` (the default) keeps
 * today's HTTP 410 behavior untouched.
 */
export async function handleCheckoutRequest(
  request: Request,
  dependencies: CheckoutRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (dependencies.billingMode() === "marketplace_free") {
    return dependencies.retiredMarketplaceFreeResponse(request);
  }

  const viewer = await dependencies.authorizeViewer();
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid checkout request", 400);
  }

  const priceConfig = dependencies.priceConfig();
  const secretKey = dependencies.stripeSecretKey();
  if (!priceConfig || !secretKey) {
    return jsonError("Stripe billing is not configured", 503);
  }

  const databaseUrl = dependencies.databaseUrl();
  if (!databaseUrl) {
    return jsonError("Database not configured", 503);
  }

  const appUrl = dependencies.appUrl();
  const successUrl = parsed.data.successUrl ?? (appUrl ? `${appUrl}/settings/billing?checkout=success` : undefined);
  const cancelUrl = parsed.data.cancelUrl ?? (appUrl ? `${appUrl}/settings/billing?checkout=canceled` : undefined);
  if (!successUrl || !cancelUrl) {
    return jsonError("successUrl and cancelUrl are required (no default app URL configured)", 400);
  }

  const workspaceId = parsed.data.workspaceId;
  const tenantId = workspaceId ?? viewer.login;
  const existing = await dependencies.getExistingCustomer(tenantId, databaseUrl);
  const priceId = priceIdForTier(parsed.data.tier, parsed.data.interval, priceConfig);
  const client = dependencies.createBillingClient(secretKey);
  const session = await client.createCheckoutSession({
    ...(existing?.stripeCustomerId ? { customerId: existing.stripeCustomerId } : {}),
    clientReferenceId: tenantId,
    priceId,
    successUrl,
    cancelUrl,
    ...(workspaceId ? { metadata: { workspace_id: workspaceId, creator_login: viewer.login } } : {}),
  });

  return Response.json({ ok: true, url: session.url }, { status: 200, headers: noStoreHeaders });
}

export async function POST(request: Request): Promise<Response> {
  return handleCheckoutRequest(request);
}
