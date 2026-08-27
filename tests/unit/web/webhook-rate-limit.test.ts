import { afterEach, describe, expect, it } from "vitest";
import { checkWebhookRateLimit, resetWebhookRateLimitForTests } from "../../../apps/web/lib/webhook-rate-limit.js";

afterEach(() => {
  resetWebhookRateLimitForTests();
});

describe("checkWebhookRateLimit", () => {
  it("allows requests under the configured per-minute limit", () => {
    const env = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "3" };
    const now = 1_000_000;
    expect(checkWebhookRateLimit("installation-1", "delivery-1", { environment: env, now })).toEqual({
      allowed: true,
    });
    expect(checkWebhookRateLimit("installation-1", "delivery-2", { environment: env, now })).toEqual({
      allowed: true,
    });
  });

  it("rejects once the key exceeds the limit within the same window, with a retry-after estimate", () => {
    const env = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "2" };
    const now = 1_000_000;
    checkWebhookRateLimit("installation-2", "delivery-1", { environment: env, now });
    checkWebhookRateLimit("installation-2", "delivery-2", { environment: env, now });
    const third = checkWebhookRateLimit("installation-2", "delivery-3", { environment: env, now });

    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("treats a redelivered (duplicate) delivery id as free, regardless of the count limit", () => {
    const env = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    checkWebhookRateLimit("installation-3", "delivery-1", { environment: env, now });
    const redelivered = checkWebhookRateLimit("installation-3", "delivery-1", { environment: env, now: now + 500 });
    expect(redelivered).toEqual({ allowed: true });
  });

  it("resets the count once the window has elapsed", () => {
    const env = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    checkWebhookRateLimit("installation-4", "delivery-1", { environment: env, now });
    const limited = checkWebhookRateLimit("installation-4", "delivery-2", { environment: env, now: now + 1000 });
    expect(limited.allowed).toBe(false);

    const afterWindow = checkWebhookRateLimit("installation-4", "delivery-3", { environment: env, now: now + 61_000 });
    expect(afterWindow).toEqual({ allowed: true });
  });

  it("falls back to the default limit for an invalid configured value", () => {
    const now = 1_000_000;
    const env = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "not-a-number" };
    expect(checkWebhookRateLimit("installation-5", "delivery-1", { environment: env, now })).toEqual({
      allowed: true,
    });
  });
});
