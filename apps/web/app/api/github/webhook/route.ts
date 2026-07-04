import { verifyGitHubWebhook } from "@boardreadyops/cloud-core";
import { normalizeGitHubAppWebhook } from "@boardreadyops/cloud-core/lifecycle";

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

  return Response.json(
    {
      ok: true,
      status: "accepted",
      event,
      delivery,
      action: lifecycle.action,
      lifecycleActions: lifecycle.actions,
    },
    { status: 202 },
  );
}
