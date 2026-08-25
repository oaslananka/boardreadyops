import type {
  ComponentIntelligenceProvider,
  ComponentLifecycleStatus,
  ComponentObservation,
  ComponentQuery,
  ProviderCachePolicy,
} from "./component-intelligence.js";

/**
 * Nexar (Octopart) component intelligence, queried under one customer's credentials.
 *
 * ADR-0012 established why this is per customer rather than a shared BoardReadyOps
 * subscription: Nexar's licence is non-transferable, so one licensee's answer may not serve
 * another. The cache policy below encodes that, and the supply watch enforces it — this
 * provider cannot be plugged in and accidentally operated as a shared account.
 *
 * The query shape is taken from Nexar's published documentation rather than from a live
 * account. Field names, the token endpoint and the enumerated lifecycle values are documented;
 * the OAuth scope is not, which is why it is configurable rather than guessed at here.
 */

const defaultTokenEndpoint = "https://identity.nexar.com/connect/token";
const defaultGraphqlEndpoint = "https://api.nexar.com/graphql/";
const defaultScope = "supply.domain";

/**
 * §1.2(vi) prohibits caching Nexar data for more than twenty-four hours.
 * §1.1 / §1.2(i) make the licence non-transferable, so a cross-tenant cache is unavailable.
 */
const nexarCachePolicy: ProviderCachePolicy = {
  maximumCacheAgeMs: 24 * 60 * 60 * 1000,
  shareableAcrossTenants: false,
};

/** Nexar returns at most a handful of parts per query; keep each request bounded. */
const maximumPartsPerRequest = 20;
const partsPerMatch = 1;
const tokenExpirySafetyMs = 60_000;

/** Raised when the provider refuses the credential, so the caller can record it as rejected. */
export class ComponentIntelligenceCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComponentIntelligenceCredentialError";
  }
}

export type NexarProviderOptions = {
  clientId: string;
  clientSecret: string;
  /** Injected so the provider is testable without network access. */
  fetch?: typeof globalThis.fetch;
  tokenEndpoint?: string;
  graphqlEndpoint?: string;
  /** Nexar does not document the supply scope; override when an account requires another. */
  scope?: string;
  now?: () => Date;
};

/**
 * Maps Nexar's homogenised lifecycle vocabulary onto ours.
 *
 * Anything unrecognised becomes `unknown` rather than `active`. Treating an unfamiliar status
 * as healthy would report a board as clean on the strength of a value nobody has read.
 */
export function nexarLifecycleStatus(value: string | undefined): ComponentLifecycleStatus {
  switch (value?.trim().toLowerCase()) {
    case "production":
    case "new":
      return "active";
    case "nrnd":
    case "not recommended for new designs":
      return "nrnd";
    case "eol":
    case "end of life":
      return "eol";
    case "obsolete":
      return "obsolete";
    default:
      return "unknown";
  }
}

type NexarPart = {
  mpn?: string;
  manufacturer?: { name?: string };
  specs?: { attribute?: { shortname?: string }; displayValue?: string }[];
};

function specValue(part: NexarPart, shortname: string): string | undefined {
  return part.specs?.find((spec) => spec.attribute?.shortname === shortname)?.displayValue;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

const lifecycleQuery = `query BoardReadyOpsLifecycle($queries: [SupPartMatchQuery!]!) {
  supMultiMatch(queries: $queries) {
    reference
    parts {
      mpn
      manufacturer { name }
      specs { attribute { shortname } displayValue }
    }
  }
}`;

export function createNexarComponentIntelligenceProvider(options: NexarProviderOptions): ComponentIntelligenceProvider {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const tokenEndpoint = options.tokenEndpoint ?? defaultTokenEndpoint;
  const graphqlEndpoint = options.graphqlEndpoint ?? defaultGraphqlEndpoint;
  const scope = options.scope ?? defaultScope;

  if (!options.clientId.trim() || !options.clientSecret.trim()) {
    throw new ComponentIntelligenceCredentialError("Nexar credentials are incomplete");
  }

  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    const current = now().getTime();
    if (token && token.expiresAt > current) return token.value;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: options.clientId,
      client_secret: options.clientSecret,
      scope,
    });
    const response = await request(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // The credential itself is the problem. Deliberately not echoing the response body:
      // token endpoints commonly reflect the submitted client_id back in errors.
      throw new ComponentIntelligenceCredentialError(`Nexar rejected the credential (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error(`Nexar token request failed (HTTP ${response.status})`);

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new Error("Nexar token response contained no access token");
    const lifetimeMs = Math.max(0, (payload.expires_in ?? 0) * 1000 - tokenExpirySafetyMs);
    token = { value: payload.access_token, expiresAt: current + lifetimeMs };
    return token.value;
  }

  return {
    name: "nexar",
    cachePolicy: nexarCachePolicy,

    async lookup(parts) {
      if (parts.length === 0) return [];
      const observations: ComponentObservation[] = [];

      for (const batch of chunked(parts, maximumPartsPerRequest)) {
        const bearer = await accessToken();
        const response = await request(graphqlEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          body: JSON.stringify({
            query: lifecycleQuery,
            variables: {
              queries: batch.map((part, index) => ({
                mpn: part.mpn,
                reference: String(index),
                limit: partsPerMatch,
              })),
            },
          }),
        });

        if (response.status === 401 || response.status === 403) {
          token = undefined;
          throw new ComponentIntelligenceCredentialError(`Nexar rejected the credential (HTTP ${response.status})`);
        }
        if (!response.ok) throw new Error(`Nexar lookup failed (HTTP ${response.status})`);

        const payload = (await response.json()) as {
          data?: { supMultiMatch?: { reference?: string; parts?: NexarPart[] }[] };
          errors?: { message?: string }[];
        };
        if (payload.errors?.length) {
          // GraphQL reports errors with HTTP 200, so this is the only place a schema drift or
          // a quota refusal becomes visible.
          throw new Error(`Nexar lookup returned errors: ${payload.errors.length}`);
        }

        const observedAt = now();
        for (const match of payload.data?.supMultiMatch ?? []) {
          const query = queryFor(batch, match.reference);
          if (!query) continue;
          const part = selectPart(match.parts ?? [], query);
          if (!part) continue;
          const status = nexarLifecycleStatus(specValue(part, "lifecyclestatus"));
          if (status === "unknown") continue;
          observations.push({
            mpn: query.mpn,
            ...(query.manufacturer === undefined ? {} : { manufacturer: query.manufacturer }),
            status,
            source: "nexar",
            observedAt,
          });
        }
      }

      return observations;
    },
  };
}

function queryFor(batch: readonly ComponentQuery[], reference: string | undefined): ComponentQuery | undefined {
  if (reference === undefined) return undefined;
  const index = Number.parseInt(reference, 10);
  return Number.isInteger(index) ? batch[index] : undefined;
}

/**
 * Picks the part a query actually asked about.
 *
 * A match can return several manufacturers' parts under one MPN, and lifecycle status differs
 * between them. When the BOM named a manufacturer, only that manufacturer's part answers the
 * question; guessing would attach one vendor's obsolescence to another's part.
 */
function selectPart(parts: readonly NexarPart[], query: ComponentQuery): NexarPart | undefined {
  if (!query.manufacturer?.trim()) return parts[0];
  const wanted = query.manufacturer.trim().toLowerCase();
  return parts.find((part) => part.manufacturer?.name?.trim().toLowerCase() === wanted);
}
