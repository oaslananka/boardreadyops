import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { remoteMcpOrigin, stagingRemoteMcpOrigin } from "./remote-mcp-foundation.js";
import { createRemoteMcpTokenIssuer } from "./remote-mcp-token-issuer.js";
import { configuredSessionSecret } from "./user-session.js";

const issuer = remoteMcpOrigin;

function parseRetiredPublicJwks(raw: string): unknown {
  if (raw.length > 12000) throw new Error("Previous JWKS is too large");
  const doc: unknown = JSON.parse(raw);
  if (
    !doc ||
    typeof doc !== "object" ||
    Array.isArray(doc) ||
    Object.keys(doc).length !== 1 ||
    !Array.isArray((doc as { keys?: unknown }).keys)
  ) {
    throw new Error("Expected a JWKS object containing only keys");
  }
  return (doc as { keys: unknown[] }).keys;
}

/**
 * Remote OAuth remains completely unpublished unless the operator explicitly
 * enables it AND all prerequisites (including a stable signing key) validate.
 * Production secrets come from the deployment's secret manager, not code.
 */
export function configuredRemoteMcpOAuth(environment: Readonly<Record<string, string | undefined>>) {
  if (
    environment.BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED !== "true" ||
    // Runtime mode must match this process's preloaded resource identity.
    // A mismatched injection, startup setting or staging/production mix fails closed.
    (environment.BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED !== undefined &&
      environment.BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED !== "false" &&
      environment.BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED !== "true") ||
    (environment.BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED === "true") !==
      (remoteMcpOrigin === stagingRemoteMcpOrigin) ||
    environment.BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER !== issuer ||
    !environment.DATABASE_URL ||
    !configuredSessionSecret(environment) ||
    !environment.BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY ||
    !environment.BOARDREADYOPS_REMOTE_MCP_KEY_ID
  )
    return null;
  try {
    const tokenIssuer = createRemoteMcpTokenIssuer({
      issuer,
      privateKeyPem: environment.BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY.replaceAll(String.raw`\n`, "\n"),
      keyId: environment.BOARDREADYOPS_REMOTE_MCP_KEY_ID,
      previousPublicKeys: environment.BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS
        ? parseRetiredPublicJwks(environment.BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS)
        : undefined,
    });
    const connectionString = environment.DATABASE_URL;
    return {
      issuer,
      sessionSecret: configuredSessionSecret(environment) as string,
      tokenIssuer,
      openDb: async () => createPgQueryExecutor({ connectionString, max: 1 }),
    };
  } catch {
    // Invalid, too-short or rotated-away signing keys must NEVER fail open.
    return null;
  }
}
