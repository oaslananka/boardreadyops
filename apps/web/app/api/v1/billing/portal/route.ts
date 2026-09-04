import { portalRequestSchema } from "@boardreadyops/contracts";
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

export interface PortalRouteDependencies {
  billingMode(): BillingMode;
  retiredMarketplaceFreeResponse(request: Request): Promise<Response>;
  authorizeViewer(): Promise<{ login: string } | undefined>;
  stripeSecretKey(): string | undefined;
  databaseUrl(): string | undefined;
  getExistingCustomer(tenantId: string, databaseUrl: string): Promise<{ stripeCustomerId: string | null } | null>;
  createBillingClient(secretKey: string): StripeBillingClient;
  appUrl(): string | undefined;
}

const defaultDependencies: PortalRouteDependencies = {
  billingMode: resolveBillingMode,
  retiredMarketplaceFreeResponse: retiredPaidBillingPost,
  async authorizeViewer() {
    const viewer = await viewerAuthorization();
    return viewer.session ? { login: viewer.session.login } : undefined;
  },
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
 * Opens a Stripe Billing Portal session for the signed-in viewer's tenant. Requires a Stripe
 * customer already linked via a prior checkout (`checkout.session.completed`) -- there is
 * nothing to manage otherwise, so this returns 409 rather than silently creating one.
 */
export async function handlePortalRequest(
  request: Request,
  dependencies: PortalRouteDependencies = defaultDependencies,
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
  const parsed = portalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid portal request", 400);
  }

  const secretKey = dependencies.stripeSecretKey();
  if (!secretKey) {
    return jsonError("Stripe billing is not configured", 503);
  }

  const databaseUrl = dependencies.databaseUrl();
  if (!databaseUrl) {
    return jsonError("Database not configured", 503);
  }

  const tenantId = viewer.login;
  const existing = await dependencies.getExistingCustomer(tenantId, databaseUrl);
  if (!existing?.stripeCustomerId) {
    return jsonError("No Stripe customer is linked for this account yet; complete checkout first", 409);
  }

  const appUrl = dependencies.appUrl();
  const returnUrl = parsed.data.returnUrl ?? (appUrl ? `${appUrl}/settings/billing` : undefined);
  if (!returnUrl) {
    return jsonError("returnUrl is required (no default app URL configured)", 400);
  }

  const client = dependencies.createBillingClient(secretKey);
  const session = await client.createBillingPortalSession({
    customerId: existing.stripeCustomerId,
    returnUrl,
  });

  return Response.json({ ok: true, url: session.url }, { status: 200, headers: noStoreHeaders });
}

export async function POST(request: Request): Promise<Response> {
  return handlePortalRequest(request);
}
