import { createHash } from "node:crypto";
import { verifyGitHubWebhook } from "@boardreadyops/cloud-core";
import type { GitHubAppLifecycleAction, GitHubAppLifecycleResult } from "@boardreadyops/cloud-core/lifecycle";
import { normalizeGitHubAppWebhook } from "@boardreadyops/cloud-core/lifecycle";
import { emptyGitHubAppLifecycleExecutionResult } from "@boardreadyops/cloud-core/lifecycle-executor";
import type { AcceptGitHubWebhookResult } from "@boardreadyops/db/control-plane-job-store";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "../../../../lib/bounded-request-body.js";
import { CloudRuntimeConfigurationError } from "../../../../lib/cloud-runtime-config.js";
import { runnerModeSummary } from "../../../../lib/runner-mode.js";
import { emitWebhookIntakeTelemetry } from "../../../../lib/webhook-intake-telemetry.js";
import { checkWebhookRateLimit } from "../../../../lib/webhook-rate-limit.js";
import { getControlPlaneJobStore } from "./intake-store.js";

export const runtime = "nodejs";

const maximumWebhookBytes = 2 * 1024 * 1024;
const deliveryPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const eventPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

type VerifiedWebhookRequest = {
  delivery: string;
  event: string;
  parsedPayload: unknown;
  payloadBuffer: Buffer;
};

type WebhookStore = ReturnType<typeof getControlPlaneJobStore>;

function firstInstallationId(actions: readonly GitHubAppLifecycleAction[]): number | undefined {
  return actions[0]?.installation.id;
}

function firstRepository(actions: readonly GitHubAppLifecycleAction[]) {
  return actions.find((action) => "repository" in action)?.repository;
}

function routingHeaders(
  request: Request,
): { delivery: string; event: string; signatureHeader: string | null } | Response {
  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "";
  if (!eventPattern.test(event) || !deliveryPattern.test(delivery)) {
    return Response.json({ ok: false, error: "webhook routing headers are invalid" }, { status: 400 });
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
      return Response.json({ ok: false, error: "webhook payload is too large" }, { status: 413 });
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
      response: Response.json({ ok: false, error: "webhook payload is not valid JSON" }, { status: 400 }),
    };
  }
}

async function verifiedRequest(request: Request): Promise<VerifiedWebhookRequest | Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "webhook secret is not configured" }, { status: 503 });
  }

  const headers = routingHeaders(request);
  if (headers instanceof Response) return headers;

  const payloadBuffer = await boundedPayload(request);
  if (payloadBuffer instanceof Response) return payloadBuffer;

  if (!verifyGitHubWebhook({ payload: payloadBuffer, secret, signatureHeader: headers.signatureHeader })) {
    return Response.json({ ok: false, error: "invalid webhook signature" }, { status: 401 });
  }

  const parsedPayload = parsedJson(payloadBuffer);
  if (!parsedPayload.ok) return parsedPayload.response;

  return { ...headers, payloadBuffer, parsedPayload: parsedPayload.value };
}

function configuredStore(startedAt: number): WebhookStore | Response {
  try {
    return getControlPlaneJobStore();
  } catch (error) {
    if (!(error instanceof CloudRuntimeConfigurationError)) throw error;
    emitWebhookIntakeTelemetry({
      outcome: "enqueue_failed",
      latencyMs: performance.now() - startedAt,
      errorClass: error.name,
    });
    return Response.json(
      { ok: false, error: "cloud persistence is not configured", code: error.code },
      { status: 503 },
    );
  }
}

async function acceptLifecycle(
  store: WebhookStore,
  lifecycle: GitHubAppLifecycleResult,
  request: VerifiedWebhookRequest,
  startedAt: number,
): Promise<AcceptGitHubWebhookResult | Response> {
  const repository = firstRepository(lifecycle.actions);
  const installationExternalId = firstInstallationId(lifecycle.actions);
  const rateLimit = checkWebhookRateLimit(
    installationExternalId === undefined ? "installation:unknown" : `installation:${installationExternalId}`,
    request.delivery,
  );
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "webhook rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    return await store.acceptGitHubWebhook({
      deliveryId: request.delivery,
      eventType: request.event,
      ...(lifecycle.action ? { eventAction: lifecycle.action } : {}),
      ...(installationExternalId === undefined ? {} : { installationExternalId }),
      ...(repository ? { repositoryExternalId: repository.id, repositoryFullName: repository.fullName } : {}),
      payloadSha256: createHash("sha256").update(request.payloadBuffer).digest("hex"),
      actions: lifecycle.actions,
    });
  } catch (error) {
    emitWebhookIntakeTelemetry({
      outcome: "enqueue_failed",
      latencyMs: performance.now() - startedAt,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ ok: false, error: "webhook could not be durably accepted" }, { status: 503 });
  }
}

function acceptedResponse(
  request: VerifiedWebhookRequest,
  lifecycle: GitHubAppLifecycleResult,
  intake?: AcceptGitHubWebhookResult,
): Response {
  return Response.json(
    {
      ok: true,
      status: "accepted",
      event: request.event,
      delivery: request.delivery,
      action: lifecycle.action,
      runner: runnerModeSummary(),
      ...(intake
        ? {
            intake: {
              outcome: intake.outcome,
              queued: intake.queued,
              inboxId: intake.inboxId,
              jobId: intake.jobId,
            },
          }
        : {}),
      lifecycleActions: lifecycle.actions,
      execution: emptyGitHubAppLifecycleExecutionResult,
    },
    { status: 202 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const verified = await verifiedRequest(request);
  if (verified instanceof Response) return verified;

  const lifecycle = normalizeGitHubAppWebhook({
    event: verified.event,
    delivery: verified.delivery,
    payload: verified.parsedPayload,
  });
  if (!lifecycle.accepted) {
    return Response.json(
      {
        ok: false,
        event: verified.event,
        delivery: verified.delivery,
        error: lifecycle.reason ?? "unsupported GitHub App webhook event",
      },
      { status: 202 },
    );
  }
  if (lifecycle.actions.length === 0) return acceptedResponse(verified, lifecycle);

  const store = configuredStore(startedAt);
  if (store instanceof Response) return store;

  const intake = await acceptLifecycle(store, lifecycle, verified, startedAt);
  if (intake instanceof Response) return intake;

  emitWebhookIntakeTelemetry({ outcome: intake.outcome, latencyMs: performance.now() - startedAt });
  return acceptedResponse(verified, lifecycle, intake);
}
