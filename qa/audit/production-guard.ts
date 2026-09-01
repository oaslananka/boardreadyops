export const productionOrigins: readonly string[] = ["https://boardreadyops.com", "https://www.boardreadyops.com"];

/**
 * Throws if `baseURL` is a real BoardReadyOps production origin and the caller marked its
 * action destructive. Every current call site passes `destructive: false` because
 * production-smoke.spec.ts is read-only by design -- this exists so that changes to it (or any
 * future spec someone points at PLAYWRIGHT_BASE_URL=https://boardreadyops.com) can't silently
 * start mutating real policy/review data, per this task's security requirement (section 26).
 */
export function guardProductionSafety(baseURL: string | undefined, destructive: boolean): void {
  if (!destructive) return;
  const isProduction = Boolean(baseURL && productionOrigins.some((origin) => baseURL.startsWith(origin)));
  if (isProduction) {
    throw new Error(
      `Refusing a destructive QA action against a production origin (${baseURL}). ` +
        "If this is genuinely required, it needs an explicit human decision, not a default in test code.",
    );
  }
}
