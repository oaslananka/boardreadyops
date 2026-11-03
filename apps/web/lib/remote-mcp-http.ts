import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mcpReviewViewHtml } from "./generated-mcp-review-view.js";
import {
  authenticateRemoteMcpRequest,
  type CheckLiveRepositoryPermission,
  loadAuthorizedRemoteReview,
  type RemoteMcpPrincipal,
  type RemoteMcpTokenVerifier,
} from "./remote-mcp-access.js";
import { loadAuthorizedRemoteEvidence } from "./remote-mcp-evidence.js";
import { loadAuthorizedRemoteFindings, remoteFindingCursorFormat } from "./remote-mcp-findings.js";
import { loadAuthorizedRemoteFootprintSummary } from "./remote-mcp-footprint.js";
import { remoteMcpMetadataUrl, remoteMcpOrigin, remoteMcpResource } from "./remote-mcp-foundation.js";

/** Keep this limit synchronized with createMcpHandler.maxRequestBodySize.
 * SDK 2.3.1 enforces the *actual streamed bytes* at this same limit; this
 * cheap header gate prevents wasteful JWT and durable-grant reads when the
 * request already advertises that it is malformed or too large.
 */
const maximumRemoteMcpRequestBytes = 64 * 1024;

function rejectInvalidMcpPostHeaders(request: Request): Response | null {
  if (request.method !== "POST") return null;
  const size = request.headers.get("content-length");
  if (size !== null) {
    if (!/^(0|[1-9][0-9]*)$/u.test(size)) {
      return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
    }
    if (Number(size) > maximumRemoteMcpRequestBytes) {
      return new Response(null, { status: 413, headers: { "cache-control": "no-store" } });
    }
  }
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    return new Response(null, { status: 415, headers: { "cache-control": "no-store" } });
  }
  return null;
}

interface RemoteMcpReadDependencies {
  openDb(): Promise<Pick<PgQueryExecutor, "query" | "close">>;
  checkCurrentPermission: CheckLiveRepositoryPermission;
  /** Verified-grant production ingress injects a fresh durable OAuth check before publishing read results. */
  revalidateCurrentGrant?(): Promise<boolean>;
}

/** A single fail-closed, bounded read path for all hosted Review MCP tools. */
async function readAuthorizedRemoteMcpTool<T extends Record<string, unknown>>(
  dependencies: RemoteMcpReadDependencies,
  read: (db: Awaited<ReturnType<RemoteMcpReadDependencies["openDb"]>>) => Promise<T | null>,
) {
  let db: Awaited<ReturnType<RemoteMcpReadDependencies["openDb"]>> | undefined;
  try {
    db = await dependencies.openDb();
    const facts = await read(db);
    if (!facts || (dependencies.revalidateCurrentGrant && !(await dependencies.revalidateCurrentGrant()))) {
      return { isError: true, content: [{ type: "text" as const, text: "Review unavailable" }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(facts) }], structuredContent: facts };
  } catch {
    // Never leak repository IDs, CAD paths, database failures, tokens, or external provider details.
    return { isError: true, content: [{ type: "text" as const, text: "Review unavailable" }] };
  } finally {
    await db?.close().catch(() => undefined);
  }
}

/** Reject mismatched routes and untrusted browser origins BEFORE any grant lookup.
 * Never trust Host/Forwarded headers to construct the canonical MCP resource.
 */
function trustedRemoteMcpHttpTarget(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    return url.href === remoteMcpResource && (origin === null || origin === remoteMcpOrigin);
  } catch {
    return false;
  }
}

/** Stateless MCP v2 HTTP handler. Every request is authorized before
 * constructing the server; the public route remains behind two disabled-by-default
 * release flags and required live GitHub permission acceptance.
 */
export async function handleAuthorizedRemoteMcpHttp(
  request: Request,
  principal: RemoteMcpPrincipal,
  dependencies: RemoteMcpReadDependencies,
): Promise<Response> {
  if (!trustedRemoteMcpHttpTarget(request)) {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
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
          ({ reviewId }) =>
            readAuthorizedRemoteMcpTool(dependencies, (db) =>
              loadAuthorizedRemoteReview(db, principal, reviewId, dependencies.checkCurrentPermission),
            ),
        );
      }
      if (principal.scopes.includes("review:read")) {
        server.registerTool(
          "boardreadyops_review_findings",
          {
            description:
              "Page through at most 30 deterministic finding identifiers for an authorized current Review. No raw messages, paths or CAD.",
            inputSchema: z
              .object({
                reviewId: z.string().uuid(),
                cursor: z.string().regex(remoteFindingCursorFormat).optional(),
              })
              .strict(),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          ({ reviewId, cursor }) =>
            readAuthorizedRemoteMcpTool(dependencies, (db) =>
              loadAuthorizedRemoteFindings(db, principal, reviewId, cursor, dependencies.checkCurrentPermission),
            ),
        );
      }
      if (principal.scopes.includes("review:read")) {
        server.registerTool(
          "boardreadyops_review_footprint_summary",
          {
            description:
              "Read previously consented, client-reported PCB footprint change counts and digests for a current authorized Review. Not a fabrication or risk verdict.",
            inputSchema: z.object({ reviewId: z.string().uuid() }).strict(),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          ({ reviewId }) =>
            readAuthorizedRemoteMcpTool(dependencies, (db) =>
              loadAuthorizedRemoteFootprintSummary(db, principal, reviewId, dependencies.checkCurrentPermission),
            ),
        );
      }
      if (principal.scopes.includes("evidence:read")) {
        server.registerTool(
          "boardreadyops_evidence_get",
          {
            description:
              "Get recorded metadata and a trusted in-app Review link for a current authorized evidence revision. No raw CAD or verified fabrication verdict.",
            inputSchema: z.object({ evidenceId: z.string().uuid() }).strict(),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          ({ evidenceId }) =>
            readAuthorizedRemoteMcpTool(dependencies, (db) =>
              loadAuthorizedRemoteEvidence(db, principal, evidenceId, dependencies.checkCurrentPermission),
            ),
        );
      }
      if (principal.scopes.includes("review:read")) {
        // The shared MCP Apps view is available only AFTER signature, durable
        // grant and browser-origin checks. The view does not fetch network
        // resources, disclose bearer credentials, or claim missing evidence.
        registerAppResource(
          server,
          "PCB evidence review",
          "ui://boardreadyops/review.html",
          {
            description: "Read-only source evidence summary; no external network access",
            _meta: {
              ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: true },
            },
          },
          () => ({
            contents: [
              { uri: "ui://boardreadyops/review.html", mimeType: RESOURCE_MIME_TYPE, text: mcpReviewViewHtml },
            ],
          }),
        );
      }
      return server;
    },
    { legacy: "stateless", maxRequestBodySize: maximumRemoteMcpRequestBytes },
  );

  const response = await handler.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Stand-alone verified-grant gate: public /mcp route invokes this only when
 * both explicit release flags, signing keys and App configuration are valid.
 */
export async function handleRemoteMcpWithVerifiedGrant(
  request: Request,
  config: { issuer: string; verifier: RemoteMcpTokenVerifier } & RemoteMcpReadDependencies,
): Promise<Response> {
  if (!trustedRemoteMcpHttpTarget(request)) {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const invalidPostHeaders = rejectInvalidMcpPostHeaders(request);
  if (invalidPostHeaders) return invalidPostHeaders;
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
  return handleAuthorizedRemoteMcpHttp(request, principal, {
    openDb: config.openDb,
    checkCurrentPermission: config.checkCurrentPermission,
    // Revalidate the original signed token against the durable grant record
    // after asynchronous Review reads. A grant revoked mid-request must not
    // authorize the already-loaded facts; fail closed on verifier errors/outage.
    revalidateCurrentGrant: async () => {
      const refreshed = await authenticateRemoteMcpRequest(request, config.issuer, config.verifier);
      return (
        refreshed !== null &&
        refreshed.githubUserId === principal.githubUserId &&
        refreshed.grantId === principal.grantId &&
        refreshed.scopes.join(" ") === principal.scopes.join(" ")
      );
    },
  });
}
