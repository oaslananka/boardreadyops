import { unavailableRemoteMcpResponse } from "../../../lib/remote-mcp-foundation.js";
import { configuredRemoteMcpOAuth } from "../../../lib/remote-mcp-oauth-config.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const configuration = configuredRemoteMcpOAuth(process.env);
  if (!configuration) return unavailableRemoteMcpResponse();
  return Response.json(await configuration.tokenIssuer.publicJwks(), {
    headers: { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
  });
}
