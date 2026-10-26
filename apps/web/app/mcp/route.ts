import { unavailableRemoteMcpResponse } from "../../lib/remote-mcp-foundation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Intentional release hold for #1248. Do not mount a stateful/stdio MCP server here,
// accept legacy repository API tokens, or treat a browser cookie as an OAuth grant.
export function GET(_request: Request): Response {
  return unavailableRemoteMcpResponse();
}

export const POST = GET;
export const DELETE = GET;
