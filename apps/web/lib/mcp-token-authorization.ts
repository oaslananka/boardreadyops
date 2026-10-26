import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthenticatedApiContext } from "./api-auth.js";

export const MCP_RESOURCE_URI = "https://boardreadyops.com/mcp";
const repoIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type McpOauthConfiguration = { issuer: string; jwksUri: string };

/**
 * Resource server metadata is advertised ONLY when a trusted external OAuth 2.1
 * authorization server is explicitly configured. Never point it at the existing
 * GitHub login flow; GitHub authentication is not an MCP authorization server.
 */
export function resolveMcpOauthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): McpOauthConfiguration | undefined {
  const rawIssuer = environment.BOARDREADYOPS_MCP_OAUTH_ISSUER;
  const rawJwks = environment.BOARDREADYOPS_MCP_OAUTH_JWKS_URI;
  if (!rawIssuer || !rawJwks) return undefined;
  try {
    const issuerText = rawIssuer.trim();
    const issuer = new URL(issuerText);
    const jwks = new URL(rawJwks);
    if (issuer.protocol !== "https:" || jwks.protocol !== "https:" || issuer.origin !== jwks.origin) return undefined;
    if (
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      jwks.username ||
      jwks.password ||
      jwks.search ||
      jwks.hash
    )
      return undefined;
    if (issuerText.length > 512 || jwks.toString().length > 512) return undefined;
    return { issuer: issuerText, jwksUri: jwks.toString() };
  } catch {
    return undefined;
  }
}

export interface VerifiedMcpOAuthClaims {
  sub?: unknown;
  repository_id?: unknown;
  scope?: unknown;
  token_use?: unknown;
}

/** Returns no principal on any verification/claims failure: missing authority is never a guest session. */
export function principalFromVerifiedMcpClaims(claims: VerifiedMcpOAuthClaims): AuthenticatedApiContext | undefined {
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 256) return undefined;
  if (typeof claims.repository_id !== "string" || !repoIdPattern.test(claims.repository_id)) return undefined;
  if (typeof claims.scope !== "string" || !claims.scope.split(/\s+/u).includes("reviews:read")) return undefined;
  if (claims.token_use !== undefined && claims.token_use !== "access") return undefined;
  return {
    ok: true,
    authType: "bearer_token",
    repositoryId: claims.repository_id,
    actorId: `oauth:${claims.sub}`,
    scopes: ["reviews:read"],
  };
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticateMcpOAuthToken(
  rawToken: string,
  configuration: McpOauthConfiguration,
): Promise<AuthenticatedApiContext | undefined> {
  if (rawToken.length > 8192 || rawToken.split(".").length !== 3) return undefined;
  try {
    let jwks = jwksCache.get(configuration.jwksUri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(configuration.jwksUri), { timeoutDuration: 2500, cooldownDuration: 30_000 });
      jwksCache.set(configuration.jwksUri, jwks);
    }
    const { payload } = await jwtVerify(rawToken, jwks, {
      issuer: configuration.issuer,
      audience: MCP_RESOURCE_URI,
      algorithms: ["RS256", "ES256"],
      maxTokenAge: "15m",
      clockTolerance: 5,
      requiredClaims: ["iat", "exp", "sub"],
    });
    return principalFromVerifiedMcpClaims(payload);
  } catch {
    return undefined;
  }
}
