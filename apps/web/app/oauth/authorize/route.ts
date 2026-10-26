import { handleRemoteMcpConsentGet, handleRemoteMcpConsentPost } from "../../../lib/remote-mcp-consent-http.js";
import { unavailableRemoteMcpResponse } from "../../../lib/remote-mcp-foundation.js";
import { configuredRemoteMcpOAuth } from "../../../lib/remote-mcp-oauth-config.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const configuration = configuredRemoteMcpOAuth(process.env);
  return configuration ? handleRemoteMcpConsentGet(request, configuration) : unavailableRemoteMcpResponse();
}

export async function POST(request: Request): Promise<Response> {
  const configuration = configuredRemoteMcpOAuth(process.env);
  return configuration ? handleRemoteMcpConsentPost(request, configuration) : unavailableRemoteMcpResponse();
}
