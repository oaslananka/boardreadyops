import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createRemoteMcpTokenIssuer } from "./remote-mcp-token-issuer.js";
import { configuredSessionSecret } from "./user-session.js";

const issuer = "https://boardreadyops.com";

/**
 * Remote OAuth remains completely unpublished unless the operator explicitly
 * enables it AND all prerequisites (including a stable signing key) validate.
 * Production secrets come from the deployment's secret manager, not code.
 */
export function configuredRemoteMcpOAuth(environment: Readonly<Record<string, string | undefined>>) {
  if (
    environment.BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED !== "true" ||
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
