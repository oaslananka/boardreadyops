import {
  type ComponentIntelligenceProvider,
  createNullComponentIntelligenceProvider,
} from "@boardreadyops/cloud-core/component-intelligence";
import {
  type CircuitBreaker,
  createCircuitBreaker,
  createFixedWindowRateLimiter,
  type RateLimiter,
  withResilientProviderCalls,
} from "@boardreadyops/cloud-core/component-intelligence-resilience";
import type { CredentialCipher } from "@boardreadyops/cloud-core/credential-encryption";
import {
  ComponentIntelligenceCredentialError,
  createNexarComponentIntelligenceProvider,
} from "@boardreadyops/cloud-core/nexar-component-intelligence";
import type { ComponentIntelligenceResolver } from "@boardreadyops/cloud-core/supply-watch";
import type { InstallationCredentialStore } from "@boardreadyops/db/installation-credential-store";

/**
 * Outbound-call limits for provider lookups, keyed per installation (below) so one customer's
 * exhausted quota or broken credential cannot throttle or trip the breaker for anyone else.
 * Configurable because the right limit depends on the provider's own published rate limits,
 * which this codebase does not have a live account to observe.
 */
const defaultRateLimitPerMinute = 30;
const defaultCircuitBreakerFailureThreshold = 5;
const defaultCircuitBreakerCooldownMs = 5 * 60 * 1000;

function configuredPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

/**
 * Builds the provider an installation's lookups run under.
 *
 * This is where the customer-credential model of ADR-0012 becomes concrete: the credential is
 * read for one installation, decrypted, and used to construct a provider that only that
 * installation's boards are evaluated with.
 *
 * Every failure resolves to the null provider rather than throwing. A missing credential, a
 * key that cannot open the envelope, a malformed payload — all of them mean "we cannot look
 * anything up for this customer", and the supply watch already reports that honestly as
 * `no_provider`. Throwing would instead fail the pass and take every other installation's
 * boards down with it.
 */

/** The provider name credentials are stored under. */
export const nexarProviderName = "nexar";

/**
 * How long a constructed provider is reused.
 *
 * Long enough that a pass over many boards reuses one access token rather than re-authenticating
 * per board; short enough that a customer who fixes a revoked key sees it take effect without
 * waiting for a deploy.
 */
const providerCacheTtlMs = 5 * 60 * 1000;

type NexarCredential = { clientId: string; clientSecret: string; scope?: string };

function parseCredential(plaintext: string): NexarCredential | undefined {
  try {
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    const clientId = typeof parsed.clientId === "string" ? parsed.clientId.trim() : "";
    const clientSecret = typeof parsed.clientSecret === "string" ? parsed.clientSecret.trim() : "";
    if (!clientId || !clientSecret) return undefined;
    const scope = typeof parsed.scope === "string" && parsed.scope.trim() ? parsed.scope.trim() : undefined;
    return { clientId, clientSecret, ...(scope ? { scope } : {}) };
  } catch {
    return undefined;
  }
}

export type ComponentIntelligenceResolverDependencies = {
  credentials: InstallationCredentialStore;
  /** Absent when no encryption key is configured, which disables component intelligence. */
  cipher: CredentialCipher | undefined;
  now?: () => Date;
  /** Injected so the credential-rejection path can be exercised without network access. */
  fetch?: typeof globalThis.fetch;
  onDiagnostic?: (event: string, detail: Record<string, unknown>) => void;
  /** Defaults to `process.env`; override in tests to exercise non-default rate/breaker config. */
  environment?: NodeJS.ProcessEnv;
  /** Injected so tests can assert rate-limit/circuit-breaker behaviour deterministically. */
  rateLimiter?: RateLimiter;
  circuitBreaker?: CircuitBreaker;
};

/**
 * Wraps a provider so a refused credential is recorded and a working one clears the record.
 *
 * The supply watch must not learn about credential storage, and the provider must not learn
 * about the database, so the bookkeeping lives here between them.
 */
function recordingCredentialState(
  provider: ComponentIntelligenceProvider,
  installationId: string,
  dependencies: ComponentIntelligenceResolverDependencies,
  wasRejected: boolean,
): ComponentIntelligenceProvider {
  const now = dependencies.now ?? (() => new Date());
  return {
    name: provider.name,
    cachePolicy: provider.cachePolicy,
    async lookup(parts) {
      try {
        const observations = await provider.lookup(parts);
        // Only write on a state change: a healthy installation should not take a write per pass.
        if (wasRejected) await dependencies.credentials.clearRejection(installationId, nexarProviderName);
        return observations;
      } catch (error) {
        if (error instanceof ComponentIntelligenceCredentialError) {
          // Recorded, not deleted. A revoked key and a provider outage are indistinguishable
          // from a single failure, so the secret is kept and the customer is told instead.
          await dependencies.credentials.markRejected(installationId, nexarProviderName, error.message, now());
        }
        throw error;
      }
    },
  };
}

export function createComponentIntelligenceResolver(
  dependencies: ComponentIntelligenceResolverDependencies,
): ComponentIntelligenceResolver {
  const now = dependencies.now ?? (() => new Date());
  const nullProvider = createNullComponentIntelligenceProvider();
  const cache = new Map<string, { provider: ComponentIntelligenceProvider; expiresAt: number }>();
  const diagnostic = dependencies.onDiagnostic ?? (() => {});
  const environment = dependencies.environment ?? process.env;
  const rateLimiter =
    dependencies.rateLimiter ??
    createFixedWindowRateLimiter({
      limit: configuredPositiveInteger(
        environment,
        "BOARDREADYOPS_COMPONENT_INTELLIGENCE_RATE_LIMIT_PER_MINUTE",
        defaultRateLimitPerMinute,
        1,
        100_000,
      ),
      windowMs: 60_000,
    });
  const circuitBreaker =
    dependencies.circuitBreaker ??
    createCircuitBreaker({
      failureThreshold: configuredPositiveInteger(
        environment,
        "BOARDREADYOPS_COMPONENT_INTELLIGENCE_CIRCUIT_BREAKER_THRESHOLD",
        defaultCircuitBreakerFailureThreshold,
        1,
        1_000,
      ),
      cooldownMs: configuredPositiveInteger(
        environment,
        "BOARDREADYOPS_COMPONENT_INTELLIGENCE_CIRCUIT_BREAKER_COOLDOWN_MS",
        defaultCircuitBreakerCooldownMs,
        1_000,
        3_600_000,
      ),
    });

  return async (installationId) => {
    if (!dependencies.cipher) return nullProvider;

    const current = now().getTime();
    const cached = cache.get(installationId);
    if (cached && cached.expiresAt > current) return cached.provider;

    const stored = await dependencies.credentials.find(installationId, nexarProviderName);
    if (!stored) return nullProvider;

    const plaintext = dependencies.cipher.decrypt(stored.envelope);
    if (!plaintext) {
      // The envelope exists but this process cannot open it: almost always a key rotated
      // without listing the retired one. An operator problem, not the customer's, so it is
      // surfaced as a diagnostic rather than recorded against their credential.
      diagnostic("component_intelligence.credential_undecryptable", { installationId });
      return nullProvider;
    }

    const credential = parseCredential(plaintext);
    if (!credential) {
      diagnostic("component_intelligence.credential_malformed", { installationId });
      return nullProvider;
    }

    let provider: ComponentIntelligenceProvider;
    try {
      provider = createNexarComponentIntelligenceProvider({
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        ...(credential.scope ? { scope: credential.scope } : {}),
        ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
        now,
      });
    } catch {
      // Constructor validation only; nothing has been sent anywhere yet.
      diagnostic("component_intelligence.credential_incomplete", { installationId });
      return nullProvider;
    }

    // Rate limiter and circuit breaker sit between the raw provider and the credential-state
    // wrapper: a rejected-credential error still needs to reach recordingCredentialState
    // unwrapped so it can be told apart from an outage, while a tripped limiter/breaker throws
    // before either the network or that bookkeeping is reached.
    const resilient = withResilientProviderCalls(provider, installationId, { rateLimiter, circuitBreaker, now });
    const wrapped = recordingCredentialState(resilient, installationId, dependencies, stored.rejectedAt !== undefined);
    cache.set(installationId, { provider: wrapped, expiresAt: current + providerCacheTtlMs });
    return wrapped;
  };
}
