import { unavailableRemoteMcpResponse } from "../../../lib/remote-mcp-foundation.js";
import { configuredRemoteMcpOAuth } from "../../../lib/remote-mcp-oauth-config.js";
import {
  handleRemoteMcpConnectionsGet,
  handleRemoteMcpConnectionsPost,
} from "../../../lib/remote-mcp-revocation-http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const oauth = configuredRemoteMcpOAuth(process.env);
  return oauth ? handleRemoteMcpConnectionsGet(request, oauth) : unavailableRemoteMcpResponse();
}

export async function POST(request: Request): Promise<Response> {
  const oauth = configuredRemoteMcpOAuth(process.env);
  return oauth ? handleRemoteMcpConnectionsPost(request, oauth) : unavailableRemoteMcpResponse();
}
