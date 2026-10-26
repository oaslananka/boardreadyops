import { unavailableRemoteMcpResponse } from "../../../lib/remote-mcp-foundation.js";
import { configuredRemoteMcpOAuth } from "../../../lib/remote-mcp-oauth-config.js";
import { handleRemoteMcpTokenRequest } from "../../../lib/remote-mcp-token-http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const configuration = configuredRemoteMcpOAuth(process.env);
  if (!configuration) return unavailableRemoteMcpResponse();
  return handleRemoteMcpTokenRequest(request, {
    issuer: configuration.issuer,
    openDb: configuration.openDb,
    signAccessToken: configuration.tokenIssuer.sign,
  });
}
