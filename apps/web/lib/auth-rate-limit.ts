const windowMilliseconds = 60_000;
const defaultLimit = 20;
const maximumTrackedKeys = 10_000;

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

const entries = new Map<string, RateLimitEntry>();

export type AuthRateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

function configuredLimit(environment: NodeJS.ProcessEnv): number {
  const raw = environment.BOARDREADYOPS_AUTH_RATE_LIMIT_PER_MINUTE?.trim();
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
 * Does not itself count as an attempt -- call recordFailedAuthAttempt on actual failure.
 */
export function checkAuthRateLimit(
  key: string,
  options: { environment?: NodeJS.ProcessEnv; now?: number } = {},
): AuthRateLimitResult {
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

/** Records a failed authentication attempt against this key's window. */
export function recordFailedAuthAttempt(key: string, options: { now?: number } = {}): void {
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

/** Best-effort client identifier for rate-limit keying: first hop of X-Forwarded-For, else "unknown". */
export function clientIdentifierFromRequest(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  return firstHop && firstHop.length > 0 ? firstHop : "unknown";
}

export function resetAuthRateLimitForTests(): void {
  entries.clear();
}
