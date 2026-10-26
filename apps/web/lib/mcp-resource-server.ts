import { loadRunPcbFootprintSummary, ReviewStore } from "@boardreadyops/db";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  type AuthenticatedApiContext,
  authenticateApiRequest,
  resolveRepositoryApiContext,
  resolveReviewApiContext,
} from "./api-auth.js";
import { mcpReviewViewHtml } from "./generated-mcp-review-view.js";
import { authenticateMcpOAuthToken, resolveMcpOauthConfiguration } from "./mcp-token-authorization.js";

const REVIEW_ID = z.string().uuid();
const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export interface McpResourceDependencies {
  authenticate: typeof authenticateApiRequest;
  authorizeReview: typeof resolveReviewApiContext;
  authorizeRepository: typeof resolveRepositoryApiContext;
  reviewStore: (
    executor: PgQueryExecutor,
  ) => Pick<ReviewStore, "getReviewById" | "getFindingsForRun" | "listReviews" | "listReviewRevisions">;
  loadFootprints: typeof loadRunPcbFootprintSummary;
}

const productionDeps: McpResourceDependencies = {
  authenticate: authenticateApiRequest,
  authorizeReview: resolveReviewApiContext,
  authorizeRepository: resolveRepositoryApiContext,
  reviewStore: (executor) => new ReviewStore(executor),
  loadFootprints: loadRunPcbFootprintSummary,
};

function toolResult(value: unknown, error = false) {
  return {
    isError: error,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    // Keep all structured results bounded and explicitly source-attributed.
    structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value : {},
  };
}

/** The only evidence available to AI callers is already-persisted, repo-bound Review data. */
function createBoardReadyOpsRemoteMcpServer(
  request: Request,
  auth: AuthenticatedApiContext,
  deps: McpResourceDependencies = productionDeps,
): McpServer {
  const server = new McpServer({ name: "boardreadyops", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.registerTool(
    "boardreadyops_reviews_list",
    {
      title: "List my hardware reviews",
      description:
        "List recent BoardReadyOps reviews for the repository authorized by this connector; never crosses repositories.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ limit }) => {
      const context = await deps.authorizeRepository(auth, request);
      if (context instanceof Response) return toolResult({ status: "unavailable", reason: "not-authorized" }, true);
      try {
        const result = await deps.reviewStore(context.executor).listReviews(context.repositoryId, { limit });
        return toolResult({
          schemaVersion: 1,
          coverage: "authorized-repository-reviews",
          reviews: result.reviews.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            decision: r.decision,
            updatedAt: r.updatedAt,
          })),
          nextCursor: result.nextCursor ?? null,
        });
      } finally {
        await context.executor.close();
      }
    },
  );

  server.registerTool(
    "boardreadyops_review_get",
    {
      title: "Inspect a hardware review",
      description:
        "Read source-bound metadata for a review in your authorized repository; no CAD source or invented manufacturing verdict.",
      inputSchema: z.object({ reviewId: REVIEW_ID }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ reviewId }) => {
      const context = await deps.authorizeReview(reviewId, auth);
      if (context instanceof Response) return toolResult({ status: "unavailable", reason: "not-found" }, true);
      try {
        const review = await deps.reviewStore(context.executor).getReviewById(context.repositoryId, reviewId);
        if (!review) return toolResult({ status: "unavailable", reason: "not-found" }, true);
        const revision = (
          await deps.reviewStore(context.executor).listReviewRevisions(context.repositoryId, reviewId)
        ).find((r) => r.id === review.currentRevisionId && r.headRunId === review.headRunId);
        return toolResult({
          schemaVersion: 1,
          source: "boardreadyops-hosted-review",
          review: {
            id: review.id,
            title: review.title,
            status: review.status,
            decision: review.decision,
            headCommitSha: revision?.headCommitSha ?? null,
            baseCommitSha: revision?.baseCommitSha ?? null,
            evidenceDigest: revision?.evidenceDigest ?? null,
            updatedAt: review.updatedAt,
          },
          disclaimer: "Existing pipeline review result, not an AI approval or manufacturing guarantee.",
        });
      } finally {
        await context.executor.close();
      }
    },
  );

  server.registerTool(
    "boardreadyops_review_findings",
    {
      title: "Review verified findings",
      description:
        "List up to 30 deterministic rule findings for one authorized review. Source file paths are intentionally omitted.",
      inputSchema: z.object({ reviewId: REVIEW_ID }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ reviewId }) => {
      const context = await deps.authorizeReview(reviewId, auth);
      if (context instanceof Response) return toolResult({ status: "unavailable", reason: "not-found" }, true);
      try {
        const review = await deps.reviewStore(context.executor).getReviewById(context.repositoryId, reviewId);
        if (!review) return toolResult({ status: "unavailable", reason: "not-found" }, true);
        const facts = await deps
          .reviewStore(context.executor)
          .getFindingsForRun(context.repositoryId, review.headRunId);
        const page = facts.slice(0, 30);
        return toolResult({
          schemaVersion: 1,
          source: "boardreadyops-deterministic-findings",
          reviewId,
          findings: page.map((f) => ({
            ruleId: f.rule_id,
            severity: f.severity,
            // Some rule messages can include design details: avoid unrestricted text in remote MCP.
            fingerprint: f.fingerprint,
            kind: f.kind ?? null,
          })),
          hasMore: facts.length > page.length,
          coverage: "head-run-findings-only",
        });
      } finally {
        await context.executor.close();
      }
    },
  );

  registerAppResource(
    server,
    "PCB evidence review",
    "ui://boardreadyops/review.html",
    {
      description: "Read-only evidence summary; no source content or external network access",
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: true } },
    },
    () => ({
      contents: [{ uri: "ui://boardreadyops/review.html", mimeType: RESOURCE_MIME_TYPE, text: mcpReviewViewHtml }],
    }),
  );

  registerAppTool(
    server,
    "boardreadyops_review_footprint_summary",
    {
      title: "Review PCB change counts",
      description:
        "Read counts/digests only when the customer explicitly shared exact committed KiCad PCB evidence. Unavailable means no claims about changed objects.",
      inputSchema: z.object({ reviewId: REVIEW_ID }),
      _meta: { ui: { resourceUri: "ui://boardreadyops/review.html" } },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ reviewId }) => {
      const context = await deps.authorizeReview(reviewId, auth);
      if (context instanceof Response) return toolResult({ status: "unavailable", reason: "not-found" }, true);
      try {
        const review = await deps.reviewStore(context.executor).getReviewById(context.repositoryId, reviewId);
        if (!review) return toolResult({ status: "unavailable", reason: "not-found" }, true);
        const revision = (
          await deps.reviewStore(context.executor).listReviewRevisions(context.repositoryId, reviewId)
        ).find((r) => r.id === review.currentRevisionId && r.headRunId === review.headRunId);
        if (!revision)
          return toolResult({ schemaVersion: 1, status: "unavailable", reason: "unresolved-review-revision" });
        const summary = await deps.loadFootprints(
          context.executor,
          context.repositoryId,
          review.headRunId,
          revision.baseCommitSha ?? null,
          revision.headCommitSha,
        );
        return toolResult(
          summary ?? { schemaVersion: 1, status: "unavailable", reason: "no-consented-source-evidence" },
        );
      } finally {
        await context.executor.close();
      }
    },
  );
  return server;
}

/** Opt-in only: no cookies, no local CLI, and no authenticated tools until a repository-scoped token is verified. */
export async function handleBoardReadyOpsMcpRequest(
  request: Request,
  deps: McpResourceDependencies = productionDeps,
  enabled = process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED === "true",
): Promise<Response> {
  if (!enabled) return Response.json({ error: "not-found" }, { status: 404, headers: noStore });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...noStore, allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > 32768) {
    return Response.json({ error: "request-too-large" }, { status: 413, headers: noStore });
  }
  const credential = request.headers.get("authorization") ?? "";
  const oauth = resolveMcpOauthConfiguration();
  const challenge = oauth
    ? 'Bearer resource_metadata="https://boardreadyops.com/.well-known/oauth-protected-resource/mcp", scope="reviews:read"'
    : 'Bearer realm="boardreadyops", scope="reviews:read"';
  const deny = () =>
    Response.json(
      { error: "authentication-required" },
      { status: 401, headers: { ...noStore, "www-authenticate": challenge } },
    );
  if (!credential.startsWith("Bearer ")) return deny();
  const rawToken = credential.slice(7);
  let auth: Awaited<ReturnType<typeof authenticateApiRequest>> | undefined;
  if (/^bro_live_[0-9a-f]{48}$/u.test(rawToken)) {
    auth = await deps.authenticate(request, "reviews:read");
  } else if (oauth) {
    auth = await authenticateMcpOAuthToken(rawToken, oauth);
  }
  if (!auth?.ok || auth.authType !== "bearer_token" || !auth.repositoryId || !auth.scopes.includes("reviews:read")) {
    return deny();
  }
  const server = createMcpHandler(() => createBoardReadyOpsRemoteMcpServer(request, auth, deps), {
    legacy: "stateless",
    responseMode: "auto",
    maxRequestBodySize: 32768,
  });
  const response = await server.fetch(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(noStore)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
