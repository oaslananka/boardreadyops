import { verifyGitHubWebhook } from "@boardreadyops/cloud-core";
import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "../../../../../lib/bounded-request-body.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const maximumWebhookBytes = 2 * 1024 * 1024;
const deliveryPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const eventPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

const noStoreHeaders = { "cache-control": "private, no-store" } as const;

type VerifiedMarketplaceRequest = {
  delivery: string;
  event: string;
  parsedPayload: unknown;
  payloadBuffer: Buffer;
};

function routingHeaders(
  request: Request,
): { delivery: string; event: string; signatureHeader: string | null } | Response {
  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "";
  if (!eventPattern.test(event) || !deliveryPattern.test(delivery)) {
    return Response.json(
      { ok: false, error: "webhook routing headers are invalid" },
      { status: 400, headers: noStoreHeaders },
    );
  }
  return {
    event,
    delivery,
    signatureHeader: request.headers.get("x-hub-signature-256"),
  };
}

async function boundedPayload(request: Request): Promise<Buffer | Response> {
  try {
    return await readBoundedRequestBody(request, maximumWebhookBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "webhook payload is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    }
    throw error;
  }
}

type ParsedJsonResult = { ok: true; value: unknown } | { ok: false; response: Response };

function parsedJson(payloadBuffer: Buffer): ParsedJsonResult {
  try {
    return { ok: true, value: JSON.parse(payloadBuffer.toString("utf8")) };
  } catch {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "webhook payload is not valid JSON" },
        { status: 400, headers: noStoreHeaders },
      ),
    };
  }
}

async function verifiedRequest(request: Request): Promise<VerifiedMarketplaceRequest | Response> {
  const secret = process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "Marketplace webhook secret is not configured" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const headers = routingHeaders(request);
  if (headers instanceof Response) return headers;

  const payloadBuffer = await boundedPayload(request);
  if (payloadBuffer instanceof Response) return payloadBuffer;

  if (!verifyGitHubWebhook({ payload: payloadBuffer, secret, signatureHeader: headers.signatureHeader })) {
    return Response.json({ ok: false, error: "invalid webhook signature" }, { status: 401, headers: noStoreHeaders });
  }

  const parsedPayload = parsedJson(payloadBuffer);
  if (!parsedPayload.ok) return parsedPayload.response;

  return { ...headers, payloadBuffer, parsedPayload: parsedPayload.value };
}

function resolvePlanTier(planName?: string): "free" | "team" | "business" {
  if (!planName) return "free";
  const lower = planName.toLowerCase();
  if (lower.includes("business")) return "business";
  if (lower.includes("team")) return "team";
  return "free";
}

export async function POST(request: Request): Promise<Response> {
  const verified = await verifiedRequest(request);
  if (verified instanceof Response) return verified;

  const { event, delivery, parsedPayload } = verified;

  if (event === "ping") {
    return Response.json(
      { ok: true, status: "accepted", event: "ping", delivery },
      { status: 200, headers: noStoreHeaders },
    );
  }

  if (event !== "marketplace_purchase") {
    return Response.json(
      { ok: true, ignored: true, reason: "unsupported_event", event, delivery },
      { status: 200, headers: noStoreHeaders },
    );
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    return Response.json(
      { ok: false, error: "invalid marketplace payload structure" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const payload = parsedPayload as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : undefined;
  const effectiveDate = typeof payload.effective_date === "string" ? payload.effective_date : undefined;
  const marketplacePurchase = (
    typeof payload.marketplace_purchase === "object" &&
    payload.marketplace_purchase !== null &&
    !Array.isArray(payload.marketplace_purchase)
      ? payload.marketplace_purchase
      : undefined
  ) as Record<string, unknown> | undefined;

  const account = (
    typeof marketplacePurchase?.account === "object" &&
    marketplacePurchase.account !== null &&
    !Array.isArray(marketplacePurchase.account)
      ? marketplacePurchase.account
      : undefined
  ) as Record<string, unknown> | undefined;

  const accountLogin = typeof account?.login === "string" ? account.login.trim() : undefined;
  const plan = (
    typeof marketplacePurchase?.plan === "object" &&
    marketplacePurchase.plan !== null &&
    !Array.isArray(marketplacePurchase.plan)
      ? marketplacePurchase.plan
      : undefined
  ) as Record<string, unknown> | undefined;

  const planName = typeof plan?.name === "string" ? plan.name : undefined;
  const onFreeTrial = Boolean(marketplacePurchase?.on_free_trial);

  if (!action || !accountLogin) {
    return Response.json(
      { ok: false, error: "missing action or account login in marketplace purchase payload" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json(
      { ok: true, received: true, mode: "no-db", action, delivery },
      { status: 200, headers: noStoreHeaders },
    );
  }

  const sanitizedMetadata = {
    deliveryId: delivery,
    action,
    accountLogin,
    accountId: typeof account?.id === "number" ? account.id : undefined,
    accountType: typeof account?.type === "string" ? account.type : undefined,
    planId: typeof plan?.id === "number" ? plan.id : undefined,
    planName,
    priceModel: typeof plan?.price_model === "string" ? plan.price_model : undefined,
    billingCycle:
      typeof marketplacePurchase?.billing_cycle === "string" ? marketplacePurchase.billing_cycle : undefined,
    effectiveDate,
    onFreeTrial,
    freeTrialEndsOn:
      typeof marketplacePurchase?.free_trial_ends_on === "string" ? marketplacePurchase.free_trial_ends_on : null,
  };

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new BillingStore(executor);
    const { inserted } = await store.recordMarketplaceEvent({
      deliveryId: delivery,
      action,
      tenantId: accountLogin,
      payload: sanitizedMetadata,
    });

    if (!inserted) {
      return Response.json({ ok: true, duplicate: true, delivery }, { status: 200, headers: noStoreHeaders });
    }

    if (action === "purchased" || action === "changed") {
      const tier = resolvePlanTier(planName);
      const status = onFreeTrial ? "trialing" : "active";
      await store.applyMarketplacePurchase({
        tenantId: accountLogin,
        tier,
        status,
        effectiveDate,
      });
      await store.markMarketplaceEventProcessed(delivery);
      return Response.json({ ok: true, processed: true, action, tier }, { status: 200, headers: noStoreHeaders });
    }

    if (action === "cancelled") {
      await store.applyMarketplaceCancellation({
        tenantId: accountLogin,
        effectiveDate,
      });
      await store.markMarketplaceEventProcessed(delivery);
      return Response.json(
        { ok: true, processed: true, action: "cancelled", tier: "free" },
        { status: 200, headers: noStoreHeaders },
      );
    }

    if (action === "pending_change" || action === "pending_change_cancelled") {
      await store.markMarketplaceEventProcessed(delivery);
      return Response.json(
        { ok: true, processed: true, action, pending: true },
        { status: 200, headers: noStoreHeaders },
      );
    }

    await store.markMarketplaceEventProcessed(delivery);
    return Response.json(
      { ok: true, ignored: true, reason: "unsupported_action", action },
      { status: 200, headers: noStoreHeaders },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "Marketplace webhook could not be durably accepted",
        code: error instanceof Error ? error.name : "UnknownError",
      },
      { status: 503, headers: noStoreHeaders },
    );
  } finally {
    await executor.close();
  }
}
