import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { POST as webhookPost } from "../../../apps/web/app/api/v1/billing/webhook/route.js";

function signedRequest(payload: object, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://boardreadyops.com/api/v1/billing/webhook", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${digest}` },
  });
}

describe("POST /api/v1/billing/webhook", () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalMode = process.env.BOARDREADYOPS_PERSISTENCE_MODE;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    if (originalMode === undefined) delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
    else process.env.BOARDREADYOPS_PERSISTENCE_MODE = originalMode;
  });

  it("returns 503 when no webhook secret is configured, so Stripe retries instead of silently dropping the event", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await webhookPost(
      new Request("https://boardreadyops.com/api/v1/billing/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("rejects a request with an invalid signature via the shared verifyStripeWebhook check, not a bespoke comparison", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_1234567890";
    const res = await webhookPost(
      new Request("https://boardreadyops.com/api/v1/billing/webhook", {
        method: "POST",
        body: JSON.stringify({ id: "evt_1", type: "invoice.paid" }),
        headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a correctly signed request and durably records the event without a real database", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_1234567890";
    process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
    const request = signedRequest(
      { id: "evt_ok_1", type: "checkout.session.completed" },
      "whsec_test_secret_1234567890",
    );

    const res = await webhookPost(request);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; mode?: string };
    expect(json.ok).toBe(true);
  });

  it("rejects malformed JSON even with a valid signature", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_1234567890";
    const body = "not json";
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", "whsec_test_secret_1234567890").update(`${timestamp}.${body}`).digest("hex");
    const res = await webhookPost(
      new Request("https://boardreadyops.com/api/v1/billing/webhook", {
        method: "POST",
        body,
        headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${digest}` },
      }),
    );
    expect(res.status).toBe(400);
  });
});
