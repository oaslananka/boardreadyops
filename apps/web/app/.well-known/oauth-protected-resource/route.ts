import { MCP_RESOURCE_URI, resolveMcpOauthConfiguration } from "../../../lib/mcp-token-authorization.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const oauth = resolveMcpOauthConfiguration();
  if (process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED !== "true" || !oauth) {
    return Response.json({ error: "not-found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return Response.json(
    {
      resource: MCP_RESOURCE_URI,
      authorization_servers: [oauth.issuer],
      scopes_supported: ["reviews:read"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } },
  );
}
