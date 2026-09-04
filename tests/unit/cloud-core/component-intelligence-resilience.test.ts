import { describe, expect, it } from "vitest";
import type { ComponentIntelligenceProvider } from "../../../packages/cloud-core/src/component-intelligence.js";
import {
  createCircuitBreaker,
  createFixedWindowRateLimiter,
  ProviderCircuitOpenError,
  ProviderRateLimitedError,
  withResilientProviderCalls,
} from "../../../packages/cloud-core/src/component-intelligence-resilience.js";

describe("createFixedWindowRateLimiter", () => {
  it("allows calls under the limit within a window", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.tryAcquire("installation-1", now)).toEqual({ allowed: true });
    expect(limiter.tryAcquire("installation-1", now)).toEqual({ allowed: true });
  });

  it("rejects once the limit is reached within the same window, with a retry-after estimate", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.tryAcquire("installation-1", now)).toEqual({ allowed: true });
    const result = limiter.tryAcquire("installation-1", now + 1_000);

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterMs).toBe(59_000);
  });

  it("resets once the window has elapsed", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.tryAcquire("installation-1", now)).toEqual({ allowed: true });
    expect(limiter.tryAcquire("installation-1", now + 59_000).allowed).toBe(false);
    expect(limiter.tryAcquire("installation-1", now + 60_000)).toEqual({ allowed: true });
  });

  it("tracks distinct keys independently", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.tryAcquire("installation-a", now)).toEqual({ allowed: true });
    // installation-a is now over its own limit; installation-b has its own untouched budget.
    expect(limiter.tryAcquire("installation-a", now).allowed).toBe(false);
    expect(limiter.tryAcquire("installation-b", now)).toEqual({ allowed: true });
  });
});

describe("createCircuitBreaker", () => {
  it("stays closed below the failure threshold", () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    const now = 1_000_000;

    breaker.onFailure("installation-1", now);
    breaker.onFailure("installation-1", now);

    expect(breaker.canProceed("installation-1", now)).toEqual({ allowed: true });
  });

  it("opens after the failure threshold is reached, and blocks calls until the cooldown elapses", () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    const now = 1_000_000;

    breaker.onFailure("installation-1", now);
    breaker.onFailure("installation-1", now);
    breaker.onFailure("installation-1", now);

    const blocked = breaker.canProceed("installation-1", now + 1_000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBe(59_000);
  });

  it("moves open -> half-open once the cooldown elapses, allowing exactly one trial call", () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const now = 1_000_000;

    breaker.onFailure("installation-1", now);
    expect(breaker.canProceed("installation-1", now + 59_999).allowed).toBe(false);
    expect(breaker.canProceed("installation-1", now + 60_000)).toEqual({ allowed: true });
  });

  it("closes on a half-open trial's success, resetting the failure count", () => {
    const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    const now = 1_000_000;

    breaker.onFailure("installation-1", now);
    breaker.onFailure("installation-1", now);
    breaker.canProceed("installation-1", now + 60_000); // half-open
    breaker.onSuccess("installation-1");

    // Closed again with the failure count reset: one subsequent failure (below the threshold
    // of 2) must not immediately reopen it the way it would have without the reset.
    breaker.onFailure("installation-1", now + 61_000);
    expect(breaker.canProceed("installation-1", now + 61_000)).toEqual({ allowed: true });
  });

  it("reopens (with a fresh cooldown) on a half-open trial's failure", () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const now = 1_000_000;

    breaker.onFailure("installation-1", now);
    breaker.canProceed("installation-1", now + 60_000); // half-open
    breaker.onFailure("installation-1", now + 60_000);

    const blocked = breaker.canProceed("installation-1", now + 60_500);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBe(59_500);
  });

  it("tracks distinct keys independently", () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const now = 1_000_000;

    breaker.onFailure("installation-a", now);

    expect(breaker.canProceed("installation-a", now).allowed).toBe(false);
    expect(breaker.canProceed("installation-b", now)).toEqual({ allowed: true });
  });
});

function healthyProvider(): ComponentIntelligenceProvider {
  return {
    name: "test",
    cachePolicy: { maximumCacheAgeMs: 0, shareableAcrossTenants: false },
    async lookup(parts) {
      return parts.map((part) => ({ ...part, status: "active" as const, source: "test", observedAt: new Date(0) }));
    },
  };
}

describe("withResilientProviderCalls", () => {
  it("passes calls through when both the limiter and breaker allow them", async () => {
    const provider = withResilientProviderCalls(healthyProvider(), "installation-1", {
      rateLimiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      circuitBreaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 60_000 }),
      now: () => new Date(1_000_000),
    });

    expect(await provider.lookup([{ mpn: "A" }])).toEqual([
      { mpn: "A", status: "active", source: "test", observedAt: new Date(0) },
    ]);
  });

  it("throws ProviderRateLimitedError, without calling the provider, once the limit is exceeded", async () => {
    let calls = 0;
    const provider: ComponentIntelligenceProvider = {
      ...healthyProvider(),
      async lookup(parts) {
        calls += 1;
        return healthyProvider().lookup(parts);
      },
    };
    const resilient = withResilientProviderCalls(provider, "installation-1", {
      rateLimiter: createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 }),
      circuitBreaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 60_000 }),
      now: () => new Date(1_000_000),
    });

    await resilient.lookup([{ mpn: "A" }]);
    await expect(resilient.lookup([{ mpn: "B" }])).rejects.toBeInstanceOf(ProviderRateLimitedError);
    expect(calls).toBe(1);
  });

  it("throws ProviderCircuitOpenError, without calling the provider, once the breaker trips", async () => {
    let calls = 0;
    const failing: ComponentIntelligenceProvider = {
      ...healthyProvider(),
      async lookup() {
        calls += 1;
        throw new Error("provider unavailable");
      },
    };
    const resilient = withResilientProviderCalls(failing, "installation-1", {
      rateLimiter: createFixedWindowRateLimiter({ limit: 100, windowMs: 60_000 }),
      circuitBreaker: createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 }),
      now: () => new Date(1_000_000),
    });

    await expect(resilient.lookup([{ mpn: "A" }])).rejects.toThrow("provider unavailable");
    // The breaker is now open from that one failure; the second call must not reach the provider.
    await expect(resilient.lookup([{ mpn: "B" }])).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(calls).toBe(1);
  });

  it("recovers once the breaker's cooldown elapses and the trial call succeeds", async () => {
    let clock = 1_000_000;
    let shouldFail = true;
    const flaky: ComponentIntelligenceProvider = {
      ...healthyProvider(),
      async lookup(parts) {
        if (shouldFail) throw new Error("provider unavailable");
        return healthyProvider().lookup(parts);
      },
    };
    const resilient = withResilientProviderCalls(flaky, "installation-1", {
      rateLimiter: createFixedWindowRateLimiter({ limit: 100, windowMs: 60_000 }),
      circuitBreaker: createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 }),
      now: () => new Date(clock),
    });

    await expect(resilient.lookup([{ mpn: "A" }])).rejects.toThrow();
    clock += 60_000;
    shouldFail = false;

    expect(await resilient.lookup([{ mpn: "A" }])).toEqual([
      { mpn: "A", status: "active", source: "test", observedAt: new Date(0) },
    ]);
  });

  it("keeps one installation's tripped breaker from blocking another's calls", async () => {
    const failing: ComponentIntelligenceProvider = {
      ...healthyProvider(),
      async lookup() {
        throw new Error("provider unavailable");
      },
    };
    const rateLimiter = createFixedWindowRateLimiter({ limit: 100, windowMs: 60_000 });
    const circuitBreaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const now = () => new Date(1_000_000);

    const forA = withResilientProviderCalls(failing, "installation-a", { rateLimiter, circuitBreaker, now });
    const forB = withResilientProviderCalls(healthyProvider(), "installation-b", { rateLimiter, circuitBreaker, now });

    await expect(forA.lookup([{ mpn: "A" }])).rejects.toThrow();
    await expect(forA.lookup([{ mpn: "A" }])).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(await forB.lookup([{ mpn: "B" }])).toEqual([
      { mpn: "B", status: "active", source: "test", observedAt: new Date(0) },
    ]);
  });
});
