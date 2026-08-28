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

type MarketplacePayload = {
  action: string;
  effectiveDate: string;
  account: {
    id: number;
    login: string;
    type?: string;
  };
  installationId?: number;
  plan: {
    id?: number;
    name?: string;
  };
  billingCycle?: string;
  onFreeTrial: boolean;
  freeTrialEndsOn?: string | null;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function routingHeaders(
  request: Request,
): { delivery: string; event: string; signatureHeader: string | null } | Response {
  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "";
  if (!eventPattern.test(event) || !deliveryPattern.test(delivery)) {
    return json({ ok: false, error: "webhook routing headers are invalid" }, 400);
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
      return json({ ok: false, error: "webhook payload is too large" }, 413);
    }
    throw error;
  }
}

function parsedJson(payloadBuffer: Buffer): { ok: true; value: unknown } | { ok: false; response: Response } {
  try {
    return { ok: true, value: JSON.parse(payloadBuffer.toString("utf8")) };
  } catch {
    return { ok: false, response: json({ ok: false, error: "webhook payload is not valid JSON" }, 400) };
  }
}

async function verifiedRequest(request: Request): Promise<VerifiedMarketplaceRequest | Response> {
  const secret = process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
  if (!secret) {
    return json({ ok: false, error: "Marketplace webhook secret is not configured" }, 503);
  }

  const headers = routingHeaders(request);
  if (headers instanceof Response) return headers;

  const payloadBuffer = await boundedPayload(request);
  if (payloadBuffer instanceof Response) return payloadBuffer;

  if (!verifyGitHubWebhook({ payload: payloadBuffer, secret, signatureHeader: headers.signatureHeader })) {
    return json({ ok: false, error: "invalid webhook signature" }, 401);
  }

  const parsedPayload = parsedJson(payloadBuffer);
  if (!parsedPayload.ok) return parsedPayload.response;

  return { ...headers, payloadBuffer, parsedPayload: parsedPayload.value };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function validIsoDate(value: unknown): string | undefined {
  const normalized = nonEmptyString(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) return undefined;
  return normalized;
}

function normalizeAccount(value: unknown): MarketplacePayload["account"] | undefined {
  const account = objectValue(value);
  const id = positiveSafeInteger(account?.id);
  const login = nonEmptyString(account?.login);
  if (!id || !login) return undefined;
  const type = nonEmptyString(account?.type);
  return { id, login, ...(type ? { type } : {}) };
}

function normalizePlan(value: unknown): MarketplacePayload["plan"] {
  const plan = objectValue(value);
  const id = positiveSafeInteger(plan?.id);
  const name = nonEmptyString(plan?.name);
  return { ...(id ? { id } : {}), ...(name ? { name } : {}) };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return nonEmptyString(value);
}

function normalizeMarketplacePayload(value: unknown): MarketplacePayload | undefined {
  const payload = objectValue(value);
  const marketplacePurchase = objectValue(payload?.marketplace_purchase);
  const action = nonEmptyString(payload?.action);
  const effectiveDate = validIsoDate(payload?.effective_date);
  const account = normalizeAccount(marketplacePurchase?.account);
  if (!action || !effectiveDate || !account) return undefined;

  const normalized: MarketplacePayload = {
    action,
    effectiveDate,
    account,
    plan: normalizePlan(marketplacePurchase?.plan),
    onFreeTrial: marketplacePurchase?.on_free_trial === true,
  };
  const billingCycle = nonEmptyString(marketplacePurchase?.billing_cycle);
  if (billingCycle) normalized.billingCycle = billingCycle;
  const freeTrialEndsOn = nullableString(marketplacePurchase?.free_trial_ends_on);
  if (freeTrialEndsOn !== undefined) normalized.freeTrialEndsOn = freeTrialEndsOn;
  const installationId = positiveSafeInteger(objectValue(payload?.installation)?.id);
  if (installationId) normalized.installationId = installationId;
  return normalized;
}

export async function POST(request: Request): Promise<Response> {
  const verified = await verifiedRequest(request);
  if (verified instanceof Response) return verified;

  const { event, delivery, parsedPayload } = verified;
  if (event === "ping") {
    return json({ ok: true, status: "accepted", event: "ping", delivery }, 200);
  }
  if (event !== "marketplace_purchase") {
    return json({ ok: true, ignored: true, reason: "unsupported_event", event, delivery }, 200);
  }

  const payload = normalizeMarketplacePayload(parsedPayload);
  if (!payload) {
    return json({ ok: false, error: "invalid marketplace purchase payload" }, 400);
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return json({ ok: false, error: "Marketplace persistence is not configured" }, 503);
  }

  const sanitizedMetadata = {
    deliveryId: delivery,
    action: payload.action,
    accountLogin: payload.account.login,
    accountId: payload.account.id,
    accountType: payload.account.type,
    githubInstallationId: payload.installationId,
    planId: payload.plan.id,
    planName: payload.plan.name,
    billingCycle: payload.billingCycle,
    effectiveDate: payload.effectiveDate,
    onFreeTrial: payload.onFreeTrial,
    freeTrialEndsOn: payload.freeTrialEndsOn ?? null,
  };

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new BillingStore(executor);
    const result = await store.processMarketplaceEvent({
      deliveryId: delivery,
      action: payload.action,
      githubAccountId: payload.account.id,
      accountLogin: payload.account.login,
      accountType: payload.account.type ?? null,
      githubInstallationId: payload.installationId ?? null,
      planId: payload.plan.id ?? null,
      planName: payload.plan.name ?? null,
      planTier: "free",
      effectiveDate: payload.effectiveDate,
      payload: sanitizedMetadata,
    });

    if (result.outcome === "duplicate") {
      return json({ ok: true, duplicate: true, delivery }, 200);
    }

    const stateful = payload.action === "purchased" || payload.action === "cancelled";
    if (stateful) {
      return json(
        {
          ok: true,
          processed: true,
          action: payload.action,
          tier: "free",
          ...(result.outcome === "stale" ? { stale: true } : {}),
          ...(result.erasureQueued ? { erasureQueued: true } : {}),
        },
        200,
      );
    }

    if (payload.action === "pending_change" || payload.action === "pending_change_cancelled") {
      return json({ ok: true, processed: true, action: payload.action, pending: true }, 200);
    }

    if (payload.action === "changed") {
      return json({ ok: true, processed: true, action: payload.action, tier: "free", stateChanged: false }, 200);
    }

    return json({ ok: true, ignored: true, reason: "unsupported_action", action: payload.action }, 200);
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Marketplace webhook could not be durably accepted",
        code: error instanceof Error ? error.name : "UnknownError",
      },
      503,
    );
  } finally {
    await executor.close();
  }
}
