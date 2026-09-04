import type { ComponentIntelligenceProvider } from "./component-intelligence.js";

/**
 * Outbound-call protection for a component intelligence provider.
 *
 * `supply-watch.ts` already bounds *how often* a part is looked up via the TTL-based
 * observation cache (`observationTtlMs` / `freshObservations`). That protects the provider from
 * redundant lookups of parts it has already answered; it does nothing once a lookup is actually
 * missing from the cache. A provider that is flaky or fully down still gets called once per
 * uncached part per board, with no bound on how fast those calls arrive and no mechanism to stop
 * trying once it is clearly unavailable — a bad pass can otherwise hammer a struggling provider
 * and pile up slow failures across every board still queued behind it.
 *
 * This module adds the other half: a fixed-window rate limiter (same in-process algorithm as
 * apps/web/lib/webhook-rate-limit.ts and apps/web/lib/auth-rate-limit.ts — no Redis exists in
 * this codebase) and a closed/open/half-open circuit breaker, both keyed per caller-supplied
 * key. `component-intelligence-resolver.ts` keys both per installation, matching how a provider
 * is already resolved and cached per installation there: one customer's exhausted quota or
 * broken credential must not throttle or trip the breaker for any other installation.
 */

const maximumTrackedKeys = 10_000;

// ---- Rate limiter -----------------------------------------------------------------------

export type RateLimiterOptions = {
  /** Calls permitted per key within one window. */
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export type RateLimiter = {
  tryAcquire(key: string, now: number): RateLimitDecision;
};

type WindowEntry = { count: number; windowStartedAt: number; lastSeenAt: number };

function pruneWindowEntries(entries: Map<string, WindowEntry>, now: number, windowMs: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.lastSeenAt >= windowMs) entries.delete(key);
  }
  while (entries.size > maximumTrackedKeys) {
    const oldestKey = entries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    entries.delete(oldestKey);
  }
}

/** Fixed-window limiter: at most `limit` calls per key inside each `windowMs` window. */
export function createFixedWindowRateLimiter(options: RateLimiterOptions): RateLimiter {
  const entries = new Map<string, WindowEntry>();

  return {
    tryAcquire(key, now) {
      pruneWindowEntries(entries, now, options.windowMs);

      const existing = entries.get(key);
      if (!existing || now - existing.windowStartedAt >= options.windowMs) {
        entries.set(key, { count: 1, windowStartedAt: now, lastSeenAt: now });
        return { allowed: true };
      }

      if (existing.count >= options.limit) {
        existing.lastSeenAt = now;
        return {
          allowed: false,
          retryAfterMs: Math.max(1, existing.windowStartedAt + options.windowMs - now),
        };
      }

      existing.count += 1;
      existing.lastSeenAt = now;
      return { allowed: true };
    },
  };
}

// ---- Circuit breaker ---------------------------------------------------------------------

export type CircuitBreakerOptions = {
  /** Consecutive failures (from a closed state) before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing a single half-open trial call. */
  cooldownMs: number;
};

export type CircuitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export type CircuitBreaker = {
  /** May a call proceed for this key right now? Transitions open -> half-open once the cooldown elapses. */
  canProceed(key: string, now: number): CircuitDecision;
  /** Record a successful call: closes the circuit and resets its failure count. */
  onSuccess(key: string): void;
  /** Record a failed call: opens the circuit once `failureThreshold` consecutive failures accrue. */
  onFailure(key: string, now: number): void;
};

type CircuitEntry = { state: "closed" | "open" | "half-open"; consecutiveFailures: number; openedAt: number };

/**
 * Closed -> open after `failureThreshold` consecutive failures. Open -> half-open once
 * `cooldownMs` has elapsed, allowing exactly one trial call through. Half-open -> closed on
 * that trial's success, or back to open (cooldown restarted) on its failure.
 *
 * Single-process and not concurrency-guarded across simultaneous half-open trials: this
 * codebase evaluates boards sequentially within one supply-watch pass (see
 * `runSupplyWatchPass`'s `for` loop in supply-watch.ts), so at most one call per key is ever
 * in flight in practice.
 */
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const entries = new Map<string, CircuitEntry>();

  function entryFor(key: string): CircuitEntry {
    let entry = entries.get(key);
    if (!entry) {
      entry = { state: "closed", consecutiveFailures: 0, openedAt: 0 };
      if (entries.size >= maximumTrackedKeys) {
        const oldestKey = entries.keys().next().value;
        if (typeof oldestKey === "string") entries.delete(oldestKey);
      }
      entries.set(key, entry);
    }
    return entry;
  }

  return {
    canProceed(key, now) {
      const entry = entryFor(key);
      if (entry.state === "closed" || entry.state === "half-open") return { allowed: true };

      const elapsed = now - entry.openedAt;
      if (elapsed < options.cooldownMs) {
        return { allowed: false, retryAfterMs: options.cooldownMs - elapsed };
      }
      entry.state = "half-open";
      return { allowed: true };
    },

    onSuccess(key) {
      const entry = entryFor(key);
      entry.state = "closed";
      entry.consecutiveFailures = 0;
    },

    onFailure(key, now) {
      const entry = entryFor(key);
      entry.consecutiveFailures += 1;
      if (entry.state === "half-open" || entry.consecutiveFailures >= options.failureThreshold) {
        entry.state = "open";
        entry.openedAt = now;
      }
    },
  };
}

// ---- Provider wrapper ---------------------------------------------------------------------

/** Raised when a key has exceeded its outbound-call rate limit. */
export class ProviderRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`component intelligence provider rate limit exceeded, retry after ${retryAfterMs}ms`);
    this.name = "ProviderRateLimitedError";
  }
}

/** Raised when a key's circuit breaker is open, so the call was never attempted. */
export class ProviderCircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`component intelligence provider circuit open, retry after ${retryAfterMs}ms`);
    this.name = "ProviderCircuitOpenError";
  }
}

export type ResilientProviderOptions = {
  rateLimiter: RateLimiter;
  circuitBreaker: CircuitBreaker;
  now?: () => Date;
};

/**
 * Wraps a provider so its `lookup` calls are rate-limited and circuit-broken, keyed by
 * `key` (the caller's choice — `component-intelligence-resolver.ts` uses the installation id,
 * so one installation's quota or outage never affects another's).
 *
 * A tripped limiter or open breaker throws before the underlying provider is ever called; the
 * existing per-board failure handling in `runSupplyWatchPass` already records that as a
 * `failed` outcome and retries later, so no new failure path needs to be taught to the caller.
 */
export function withResilientProviderCalls(
  provider: ComponentIntelligenceProvider,
  key: string,
  options: ResilientProviderOptions,
): ComponentIntelligenceProvider {
  const now = options.now ?? (() => new Date());

  return {
    name: provider.name,
    cachePolicy: provider.cachePolicy,
    async lookup(parts) {
      if (parts.length === 0) return [];

      const rate = options.rateLimiter.tryAcquire(key, now().getTime());
      if (!rate.allowed) throw new ProviderRateLimitedError(rate.retryAfterMs);

      const circuit = options.circuitBreaker.canProceed(key, now().getTime());
      if (!circuit.allowed) throw new ProviderCircuitOpenError(circuit.retryAfterMs);

      try {
        const observations = await provider.lookup(parts);
        options.circuitBreaker.onSuccess(key);
        return observations;
      } catch (error) {
        options.circuitBreaker.onFailure(key, now().getTime());
        throw error;
      }
    },
  };
}
