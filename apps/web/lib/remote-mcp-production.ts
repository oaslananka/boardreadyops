import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createLocalJWKSet } from "jose";
import type { CheckLiveRepositoryPermission } from "./remote-mcp-access.js";
import { remoteMcpOrigin } from "./remote-mcp-foundation.js";
import { createProductionLiveGitHubRepositoryAccess } from "./remote-mcp-github-permission.js";
import { isRemoteMcpGrantActive } from "./remote-mcp-grant-store.js";
import { handleRemoteMcpWithVerifiedGrant } from "./remote-mcp-http.js";
import { createRemoteMcpJwtVerifier } from "./remote-mcp-jwt-verifier.js";
import { configuredRemoteMcpOAuth } from "./remote-mcp-oauth-config.js";

const canonicalIssuer = remoteMcpOrigin;
type ReadDatabase = Pick<PgQueryExecutor, "query" | "close">;

export interface PreparedRemoteMcpProductionOptions {
  issuer: string;
  publicJwks: { keys: Record<string, unknown>[] };
  openDb(): Promise<ReadDatabase>;
  checkCurrentPermission: CheckLiveRepositoryPermission;
}

/**
 * Testable, production-shaped resource adapter. Keys are supplied ONLY by
 * trusted server configuration, never from the request, its JWT headers or a
 * remote metadata URL. No session state or credentials are cached per user.
 * Its route is present but remains disabled unless both explicit release gates
 * and all signing, session, database and GitHub App prerequisites are present.
 */
export function prepareRemoteMcpProductionHandler(
  options: PreparedRemoteMcpProductionOptions,
): ((request: Request) => Promise<Response>) | null {
  if (
    options.issuer !== canonicalIssuer ||
    !Array.isArray(options.publicJwks.keys) ||
    options.publicJwks.keys.length < 1 ||
    options.publicJwks.keys.length > 4
  )
    return null;

  const knownIds = new Set<string>();
  for (const key of options.publicJwks.keys) {
    if (
      key?.kty !== "RSA" ||
      key.alg !== "RS256" ||
      key.use !== "sig" ||
      typeof key.kid !== "string" ||
      !/^[a-zA-Z0-9_-]{8,128}$/u.test(key.kid) ||
      knownIds.has(key.kid) ||
      typeof key.n !== "string" ||
      !/^[A-Za-z0-9_-]{342,1024}$/u.test(key.n) ||
      typeof key.e !== "string" ||
      !/^[A-Za-z0-9_-]{3,12}$/u.test(key.e) ||
      Object.keys(key).some((name) => !["kty", "kid", "alg", "use", "n", "e"].includes(name))
    )
      return null;
    knownIds.add(key.kid);
  }

  try {
    const verifier = createRemoteMcpJwtVerifier({
      issuer: options.issuer,
      verifyKey: createLocalJWKSet(options.publicJwks as Parameters<typeof createLocalJWKSet>[0]),
      async activeGrant(jti, userId, clientId, scope, tokenIssuer) {
        let db: ReadDatabase | undefined;
        try {
          db = await options.openDb();
          return await isRemoteMcpGrantActive(db, jti, userId, clientId, tokenIssuer, scope);
        } catch {
          return false;
        } finally {
          await db?.close().catch(() => undefined);
        }
      },
    });
    return (request) =>
      handleRemoteMcpWithVerifiedGrant(request, {
        issuer: options.issuer,
        verifier,
        openDb: options.openDb,
        checkCurrentPermission: options.checkCurrentPermission,
      });
  } catch {
    return null;
  }
}

/** Independent safety latch. OAuth issuer enablement alone does NOT expose MCP.
 * The route now requires this distinct, disabled-by-default release switch.
 */
export async function prepareConfiguredRemoteMcpProductionHandler(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<((request: Request) => Promise<Response>) | null> {
  if (
    environment.BOARDREADYOPS_REMOTE_MCP_HANDLER_READY !== "true" ||
    !environment.GITHUB_APP_ID ||
    !environment.GITHUB_APP_PRIVATE_KEY
  )
    return null;
  const oauth = configuredRemoteMcpOAuth(environment);
  if (!oauth) return null;
  try {
    return prepareRemoteMcpProductionHandler({
      issuer: oauth.issuer,
      publicJwks: await oauth.tokenIssuer.publicJwks(),
      openDb: oauth.openDb,
      checkCurrentPermission: createProductionLiveGitHubRepositoryAccess(environment, fetcher),
    });
  } catch {
    return null;
  }
}
