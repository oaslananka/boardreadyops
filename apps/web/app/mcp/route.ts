import { unavailableRemoteMcpResponse } from "../../lib/remote-mcp-foundation.js";
import { prepareConfiguredRemoteMcpProductionHandler } from "../../lib/remote-mcp-production.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Strict #1248 release gate: no browser sessions, API tokens, permissive
 * fallback, or unconfigured service. OAuth + MCP switches are both required.
 * They are intentionally NOT enabled in the production environment yet.
 */
async function respond(request: Request): Promise<Response> {
  if (
    process.env.BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED !== "true" ||
    process.env.BOARDREADYOPS_REMOTE_MCP_HANDLER_READY !== "true"
  ) {
    return unavailableRemoteMcpResponse();
  }
  try {
    const handler = await prepareConfiguredRemoteMcpProductionHandler(process.env);
    if (!handler) return unavailableRemoteMcpResponse();
    return await handler(request);
  } catch {
    // Invalid signing configuration, unavailable DB/GitHub or other internal
    // faults must never fall back to an unverified MCP transport.
    return unavailableRemoteMcpResponse();
  }
}

export const GET = respond;
export const POST = respond;
export const DELETE = respond;
