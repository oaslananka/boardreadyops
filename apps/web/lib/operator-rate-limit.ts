const windowMilliseconds = 60_000;
const defaultLimit = 20;
const maximumTrackedKeys = 10_000;

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

const entries = new Map<string, RateLimitEntry>();

export type OperatorRateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

function configuredLimit(environment: Readonly<Record<string, string | undefined>>): number {
  const raw = environment.BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return defaultLimit;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) return defaultLimit;
  return parsed;
}

function prune(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.lastSeenAt >= windowMilliseconds) entries.delete(key);
  }
  while (entries.size >= maximumTrackedKeys) {
    const oldestKey = entries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    entries.delete(oldestKey);
  }
}

/**
 * Read-only check: does this key currently have room for another failed attempt?
 * Does not itself count as an attempt -- call recordFailedOperatorAttempt on actual failure.
 */
export function checkOperatorRateLimit(
  key: string,
  options: { environment?: Readonly<Record<string, string | undefined>>; now?: number } = {},
): OperatorRateLimitResult {
  const now = options.now ?? Date.now();
  const limit = configuredLimit(options.environment ?? process.env);
  prune(now);

  const entry = entries.get(key);
  if (!entry || now - entry.windowStartedAt >= windowMilliseconds) {
    return { allowed: true };
  }
  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStartedAt + windowMilliseconds - now) / 1000)),
    };
  }
  return { allowed: true };
}

/** Records a failed operator token comparison against this key's window. */
export function recordFailedOperatorAttempt(key: string, options: { now?: number } = {}): void {
  const now = options.now ?? Date.now();
  prune(now);

  const entry = entries.get(key);
  if (!entry || now - entry.windowStartedAt >= windowMilliseconds) {
    entries.delete(key);
    entries.set(key, { count: 1, windowStartedAt: now, lastSeenAt: now });
    return;
  }
  entry.count += 1;
  entry.lastSeenAt = now;
  entries.delete(key);
  entries.set(key, entry);
}

export function resetOperatorRateLimitForTests(): void {
  entries.clear();
}
