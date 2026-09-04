import { afterEach, describe, expect, it } from "vitest";
import {
  checkOperatorRateLimit,
  recordFailedOperatorAttempt,
  resetOperatorRateLimitForTests,
} from "../../../apps/web/lib/operator-rate-limit.js";

afterEach(() => {
  resetOperatorRateLimitForTests();
});

describe("checkOperatorRateLimit / recordFailedOperatorAttempt", () => {
  it("allows a key with no recorded failures", () => {
    expect(checkOperatorRateLimit("ip-1", { now: 1_000_000 })).toEqual({ allowed: true });
  });

  it("stays allowed while failures remain under the configured limit", () => {
    const env = { BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: "3" };
    const now = 1_000_000;
    recordFailedOperatorAttempt("ip-2", { now });
    recordFailedOperatorAttempt("ip-2", { now });
    expect(checkOperatorRateLimit("ip-2", { environment: env, now })).toEqual({ allowed: true });
  });

  it("rejects once recorded failures reach the configured limit, with a retry-after estimate", () => {
    const env = { BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: "2" };
    const now = 1_000_000;
    recordFailedOperatorAttempt("ip-3", { now });
    recordFailedOperatorAttempt("ip-3", { now });
    const result = checkOperatorRateLimit("ip-3", { environment: env, now });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("does not count a successful check against the limit", () => {
    const env = { BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    checkOperatorRateLimit("ip-4", { environment: env, now });
    checkOperatorRateLimit("ip-4", { environment: env, now });
    expect(checkOperatorRateLimit("ip-4", { environment: env, now })).toEqual({ allowed: true });
  });

  it("resets once the window has elapsed", () => {
    const env = { BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    recordFailedOperatorAttempt("ip-5", { now });
    expect(checkOperatorRateLimit("ip-5", { environment: env, now: now + 1_000 }).allowed).toBe(false);
    expect(checkOperatorRateLimit("ip-5", { environment: env, now: now + 61_000 })).toEqual({ allowed: true });
  });

  it("tracks distinct keys independently", () => {
    const env = { BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: "1" };
    const now = 1_000_000;
    recordFailedOperatorAttempt("ip-6a", { now });
    expect(checkOperatorRateLimit("ip-6a", { environment: env, now }).allowed).toBe(false);
    expect(checkOperatorRateLimit("ip-6b", { environment: env, now })).toEqual({ allowed: true });
  });

  it("falls back to the default limit for an invalid configured value", () => {
    const env = { BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: "not-a-number" };
    const now = 1_000_000;
    recordFailedOperatorAttempt("ip-7", { now });
    expect(checkOperatorRateLimit("ip-7", { environment: env, now })).toEqual({ allowed: true });
  });
});
