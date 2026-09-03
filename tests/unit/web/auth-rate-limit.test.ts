import { afterEach, describe, expect, it } from "vitest";
import {
  checkAuthRateLimit,
  clientIdentifierFromRequest,
  recordFailedAuthAttempt,
  resetAuthRateLimitForTests,
} from "../../../apps/web/lib/auth-rate-limit.js";

afterEach(() => {
  resetAuthRateLimitForTests();
});

describe("checkAuthRateLimit / recordFailedAuthAttempt", () => {
  it("allows a key with no recorded failures", () => {
    expect(checkAuthRateLimit("ip-1", { now: 1_000_000 })).toEqual({ allowed: true });
  });

  it("stays allowed while failures remain under the configured limit", () => {
    const env = { BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE: "3" };
    const now = 1_000_000;
    recordFailedAuthAttempt("ip-2", { now });
    recordFailedAuthAttempt("ip-2", { now });
    expect(checkAuthRateLimit("ip-2", { environment: env, now })).toEqual({ allowed: true });
  });

  it("rejects once recorded failures reach the configured limit, with a retry-after estimate", () => {
    const env = { BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE: "2" };
    const now = 1_000_000;
    recordFailedAuthAttempt("ip-3", { now });
    recordFailedAuthAttempt("ip-3", { now });
    const result = checkAuthRateLimit("ip-3", { environment: env, now });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("does not count a successful check against the limit", () => {
    const env = { BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    checkAuthRateLimit("ip-4", { environment: env, now });
    checkAuthRateLimit("ip-4", { environment: env, now });
    expect(checkAuthRateLimit("ip-4", { environment: env, now })).toEqual({ allowed: true });
  });

  it("resets once the window has elapsed", () => {
    const env = { BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    recordFailedAuthAttempt("ip-5", { now });
    expect(checkAuthRateLimit("ip-5", { environment: env, now: now + 1_000 }).allowed).toBe(false);
    expect(checkAuthRateLimit("ip-5", { environment: env, now: now + 61_000 })).toEqual({ allowed: true });
  });

  it("tracks distinct keys independently", () => {
    const env = { BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    recordFailedAuthAttempt("ip-6a", { now });
    expect(checkAuthRateLimit("ip-6a", { environment: env, now }).allowed).toBe(false);
    expect(checkAuthRateLimit("ip-6b", { environment: env, now })).toEqual({ allowed: true });
  });

  it("falls back to the default limit for an invalid configured value", () => {
    const env = { BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE: "not-a-number" };
    const now = 1_000_000;
    recordFailedAuthAttempt("ip-7", { now });
    expect(checkAuthRateLimit("ip-7", { environment: env, now })).toEqual({ allowed: true });
  });
});

describe("clientIdentifierFromRequest", () => {
  it("uses the first hop of X-Forwarded-For", () => {
    const request = new Request("https://example.test/api/v1/runs", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(clientIdentifierFromRequest(request)).toBe("203.0.113.5");
  });

  it("falls back to unknown when the header is absent", () => {
    const request = new Request("https://example.test/api/v1/runs");
    expect(clientIdentifierFromRequest(request)).toBe("unknown");
  });
});
