const windowMilliseconds = 60_000;
const defaultLimit = 1_200;
const maximumTrackedKeys = 10_000;

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

const entries = new Map<string, RateLimitEntry>();
const recentDeliveries = new Map<string, number>();

export type WebhookRateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

function configuredLimit(environment: NodeJS.ProcessEnv): number {
  const raw = environment.BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return defaultLimit;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) return defaultLimit;
  return parsed;
}

function prune(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.lastSeenAt >= windowMilliseconds) entries.delete(key);
  }
  for (const [deliveryId, lastSeenAt] of recentDeliveries) {
    if (now - lastSeenAt >= windowMilliseconds) recentDeliveries.delete(deliveryId);
  }
  while (entries.size >= maximumTrackedKeys) {
    const oldestKey = entries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    entries.delete(oldestKey);
  }
  while (recentDeliveries.size >= maximumTrackedKeys) {
    const oldestDelivery = recentDeliveries.keys().next().value;
    if (typeof oldestDelivery !== "string") break;
    recentDeliveries.delete(oldestDelivery);
  }
}

export function checkWebhookRateLimit(
  key: string,
  deliveryId: string,
  options: { environment?: NodeJS.ProcessEnv; now?: number } = {},
): WebhookRateLimitResult {
  const now = options.now ?? Date.now();
  const limit = configuredLimit(options.environment ?? process.env);
  prune(now);

  if (recentDeliveries.has(deliveryId)) {
    recentDeliveries.delete(deliveryId);
    recentDeliveries.set(deliveryId, now);
    return { allowed: true };
  }

  const entry = entries.get(key);
  if (!entry || now - entry.windowStartedAt >= windowMilliseconds) {
    entries.delete(key);
    entries.set(key, { count: 1, windowStartedAt: now, lastSeenAt: now });
    recentDeliveries.set(deliveryId, now);
    return { allowed: true };
  }

  entries.delete(key);
  entry.lastSeenAt = now;
  entries.set(key, entry);
  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStartedAt + windowMilliseconds - now) / 1000)),
    };
  }

  entry.count += 1;
  recentDeliveries.set(deliveryId, now);
  return { allowed: true };
}

export function resetWebhookRateLimitForTests(): void {
  entries.clear();
  recentDeliveries.clear();
}
