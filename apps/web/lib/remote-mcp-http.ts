import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  authenticateRemoteMcpRequest,
  type CheckLiveRepositoryPermission,
  loadAuthorizedRemoteReview,
  type RemoteMcpPrincipal,
  type RemoteMcpTokenVerifier,
} from "./remote-mcp-access.js";
import { remoteMcpMetadataUrl } from "./remote-mcp-foundation.js";

interface RemoteMcpReadDependencies {
  openDb(): Promise<Pick<PgQueryExecutor, "query" | "close">>;
  checkCurrentPermission: CheckLiveRepositoryPermission;
}

/** Internal, stateless MCP v2 HTTP handler. Every request is authorized before
 * constructing the MCP server. Use only in tests until the OAuth release gate passes.
 */
export async function handleAuthorizedRemoteMcpHttp(
  request: Request,
  principal: RemoteMcpPrincipal,
  dependencies: RemoteMcpReadDependencies,
): Promise<Response> {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "boardreadyops-hosted-review", version: "0.1.0" },
        { maxToolInputElements: 20 },
      );
      if (principal.scopes.includes("review:read")) {
        server.registerTool(
          "boardreadyops_review_get",
          {
            description:
              "Read bounded deterministic state for one authorized BoardReadyOps hosted Review. Never a fabrication verdict.",
            inputSchema: z.object({ reviewId: z.string().uuid() }).strict(),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          async ({ reviewId }) => {
            let db: Awaited<ReturnType<RemoteMcpReadDependencies["openDb"]>> | undefined;
            try {
              db = await dependencies.openDb();
              const facts = await loadAuthorizedRemoteReview(
                db,
                principal,
                reviewId,
                dependencies.checkCurrentPermission,
              );
              if (!facts) return { isError: true, content: [{ type: "text", text: "Review unavailable" }] };
              return { content: [{ type: "text", text: JSON.stringify(facts) }], structuredContent: facts };
            } catch {
              // Do not disclose repository IDs, CAD paths, database errors or external service details.
              return { isError: true, content: [{ type: "text", text: "Review unavailable" }] };
            } finally {
              await db?.close().catch(() => undefined);
            }
          },
        );
      }
      return server;
    },
    { legacy: "stateless", maxRequestBodySize: 64 * 1024 },
  );

  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.host !== "boardreadyops.com" || url.pathname !== "/mcp") {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== "https://boardreadyops.com") {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const response = await handler.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** A stand-alone testable gate. The public /mcp route still returns 503 until
 * OAuth user consent, client discovery and an issuer are installed and accepted.
 */
export async function handleRemoteMcpWithVerifiedGrant(
  request: Request,
  config: { issuer: string; verifier: RemoteMcpTokenVerifier } & RemoteMcpReadDependencies,
): Promise<Response> {
  const principal = await authenticateRemoteMcpRequest(request, config.issuer, config.verifier);
  if (!principal) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "www-authenticate": `Bearer resource_metadata="${remoteMcpMetadataUrl}"`,
      },
    });
  }
  return handleAuthorizedRemoteMcpHttp(request, principal, config);
}
