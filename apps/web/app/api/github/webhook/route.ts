import { verifyGitHubWebhook } from "@boardreadyops/cloud-core";
import { normalizeGitHubAppWebhook } from "@boardreadyops/cloud-core/lifecycle";
import {
  emptyGitHubAppLifecycleExecutionResult,
  executeGitHubAppLifecycleActions,
} from "@boardreadyops/cloud-core/lifecycle-executor";
import { CloudRuntimeConfigurationError } from "../../../../lib/cloud-runtime-config.js";
import { createGitHubAppCheckRunClient } from "../../../../lib/github-app-check-run-client.js";
import { createRunnerClient } from "../../../../lib/runner-client.js";
import { runnerModeSummary, runnerWorkflowDispatchClient } from "../../../../lib/runner-mode.js";
import { getGitHubAppLifecycleStore } from "./lifecycle-store.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const payload = await request.text();
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const event = request.headers.get("x-github-event") ?? "unknown";
  const delivery = request.headers.get("x-github-delivery") ?? "unknown";
  const signatureHeader = request.headers.get("x-hub-signature-256");

  if (!secret) {
    return Response.json({ ok: false, error: "webhook secret is not configured" }, { status: 503 });
  }

  if (!verifyGitHubWebhook({ payload, secret, signatureHeader })) {
    return Response.json({ ok: false, error: "invalid webhook signature" }, { status: 401 });
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return Response.json({ ok: false, error: "webhook payload is not valid JSON" }, { status: 400 });
  }

  const lifecycle = normalizeGitHubAppWebhook({
    event,
    delivery,
    payload: parsedPayload,
  });

  if (!lifecycle.accepted) {
    return Response.json(
      {
        ok: false,
        event,
        delivery,
        error: lifecycle.reason ?? "unsupported GitHub App webhook event",
      },
      { status: 202 },
    );
  }

  const runner = runnerModeSummary();

  if (lifecycle.actions.length === 0) {
    return Response.json(
      {
        ok: true,
        status: "accepted",
        event,
        delivery,
        action: lifecycle.action,
        runner,
        lifecycleActions: lifecycle.actions,
        execution: emptyGitHubAppLifecycleExecutionResult,
      },
      { status: 202 },
    );
  }

  let lifecycleStore: ReturnType<typeof getGitHubAppLifecycleStore>;
  try {
    lifecycleStore = getGitHubAppLifecycleStore();
  } catch (error) {
    if (error instanceof CloudRuntimeConfigurationError) {
      return Response.json(
        {
          ok: false,
          error: "cloud persistence is not configured",
          code: error.code,
        },
        { status: 503 },
      );
    }
    throw error;
  }

  const workflowDispatchClient = runnerWorkflowDispatchClient(runner, createRunnerClient);
  const execution = await executeGitHubAppLifecycleActions(
    lifecycle.actions,
    lifecycleStore,
    createGitHubAppCheckRunClient(),
    workflowDispatchClient,
  );

  return Response.json(
    {
      ok: true,
      status: "accepted",
      event,
      delivery,
      action: lifecycle.action,
      runner,
      lifecycleActions: lifecycle.actions,
      execution,
    },
    { status: 202 },
  );
}
