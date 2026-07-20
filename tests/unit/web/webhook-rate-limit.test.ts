import { afterEach, describe, expect, it } from "vitest";
import { checkWebhookRateLimit, resetWebhookRateLimitForTests } from "../../../apps/web/lib/webhook-rate-limit.js";

afterEach(() => resetWebhookRateLimitForTests());

describe("webhook rate limit", () => {
  it("limits a verified installation key within a bounded window", () => {
    const environment = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "2" };

    expect(checkWebhookRateLimit("installation:123", "delivery-1", { environment, now: 1000 })).toEqual({
      allowed: true,
    });
    expect(checkWebhookRateLimit("installation:123", "delivery-2", { environment, now: 1001 })).toEqual({
      allowed: true,
    });
    expect(checkWebhookRateLimit("installation:123", "delivery-3", { environment, now: 1002 })).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(checkWebhookRateLimit("installation:123", "delivery-3", { environment, now: 61_001 })).toEqual({
      allowed: true,
    });
  });

  it("never blocks an immediate retry of the same GitHub delivery id", () => {
    const environment = { BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE: "1" };

    expect(checkWebhookRateLimit("installation:123", "delivery-1", { environment, now: 1000 })).toEqual({
      allowed: true,
    });
    expect(checkWebhookRateLimit("installation:123", "delivery-1", { environment, now: 1001 })).toEqual({
      allowed: true,
    });
  });
});
