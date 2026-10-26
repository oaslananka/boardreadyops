import { describe, expect, it, vi } from "vitest";
import {
  handleBoardReadyOpsMcpRequest,
  type McpResourceDependencies,
} from "../../../apps/web/lib/mcp-resource-server.js";

const repo = "00000000-0000-4000-8000-000000000111";
const reviewId = "00000000-0000-4000-8000-000000000222";
const runId = "00000000-0000-4000-8000-000000000333";
const revisionId = "00000000-0000-4000-8000-000000000444";
const token = `bro_live_${"a".repeat(48)}`;
const auth = {
  ok: true as const,
  authType: "bearer_token" as const,
  actorId: "repo-read-token",
  repositoryId: repo,
  scopes: ["reviews:read" as const],
};
const currentReview = {
  id: reviewId,
  repositoryId: repo,
  headRunId: runId,
  currentRevisionId: revisionId,
  title: "Production candidate review",
  status: "active",
  decision: "pending",
  updatedAt: "2026-10-26T00:00:00.000Z",
};
const revision = {
  id: revisionId,
  headRunId: runId,
  baseCommitSha: "1".repeat(40),
  headCommitSha: "2".repeat(40),
  evidenceDigest: "a".repeat(64),
};

function dependencies() {
  const close = vi.fn(async () => {});
  const query = vi.fn(async () => ({ rows: [] }));
  const executor = { close, query };
  const methods = {
    getReviewById: vi.fn(async () => currentReview),
    listReviewRevisions: vi.fn(async () => [revision]),
    getFindingsForRun: vi.fn(async () => [
      {
        rule_id: "pcb.rule",
        severity: "high",
        fingerprint: "b".repeat(64),
        kind: "pcb",
        path: "/private/design.kicad_pcb",
        message: "Secret CAD component R1 at (12, 22)",
      },
    ]),
    listReviews: vi.fn(async () => ({ reviews: [currentReview] })),
  };
  const authorizeReview = vi.fn(async () => ({ repositoryId: repo, executor }));
  const authorizeRepository = vi.fn(async () => ({ repositoryId: repo, executor }));
  const authenticate = vi.fn(async () => auth);
  const loadFootprints = vi.fn(async () => ({
    schemaVersion: 1,
    scope: "pcb-footprints-only",
    disclosure: "counts-and-digests-only",
    baseCommitSha: "1".repeat(40),
    headCommitSha: "2".repeat(40),
    changes: { added: 1, removed: 0, modified: 2 },
    riskAssessment: "not-evaluated",
  }));
  const deps = {
    authenticate,
    authorizeReview,
    authorizeRepository,
    reviewStore: () => methods,
    loadFootprints,
  } as unknown as McpResourceDependencies;
  return { deps, close, methods, authorizeReview, authorizeRepository, authenticate, loadFootprints };
}

function mcpRequest(method: string, params: Record<string, unknown> = {}, bearer = token, extraHeaders = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
  return new Request("https://boardreadyops.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...extraHeaders,
    },
    body,
  });
}

describe("remote MCP 2026-07-28 read-only resource boundary", () => {
  it("is invisible by default and never authenticates when disabled", async () => {
    const { deps, authenticate } = dependencies();
    const res = await handleBoardReadyOpsMcpRequest(mcpRequest("tools/list"), deps, false);
    expect(res.status).toBe(404);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects cookies or absent bearer credentials before any tool setup", async () => {
    const { deps, authenticate } = dependencies();
    const req = mcpRequest("tools/list", {}, "", { cookie: "brops_session=forged" });
    const res = await handleBoardReadyOpsMcpRequest(req, deps, true);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("reviews:read");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects invalid access scope and oversized requests", async () => {
    const fixture = dependencies();
    const res = await handleBoardReadyOpsMcpRequest(
      mcpRequest("tools/list", {}, token, {
        "content-length": "32769",
      }),
      fixture.deps,
      true,
    );
    expect(res.status).toBe(413);
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it("lists exactly four read-only tools through a real modern MCP wire request", async () => {
    const { deps } = dependencies();
    const res = await handleBoardReadyOpsMcpRequest(mcpRequest("tools/list"), deps, true);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const message = await res.json();
    expect(message.result.tools.map((x: { name: string }) => x.name)).toEqual([
      "boardreadyops_reviews_list",
      "boardreadyops_review_get",
      "boardreadyops_review_findings",
      "boardreadyops_review_footprint_summary",
    ]);
    for (const tool of message.result.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("advertises a portable MCP Apps resource on the footprint tool", async () => {
    const { deps } = dependencies();
    const response = await handleBoardReadyOpsMcpRequest(mcpRequest("tools/list"), deps, true);
    const body = await response.json();
    const tool = body.result.tools.find(
      (item: { name: string }) => item.name === "boardreadyops_review_footprint_summary",
    );
    expect(tool._meta.ui.resourceUri).toBe("ui://boardreadyops/review.html");
  });

  it("serves one self-contained read-only MCP Apps HTML resource without external asset access", async () => {
    const fixture = dependencies();
    const response = await handleBoardReadyOpsMcpRequest(
      mcpRequest(
        "resources/read",
        {
          uri: "ui://boardreadyops/review.html",
        },
        token,
        { "mcp-name": "ui://boardreadyops/review.html" },
      ),
      fixture.deps,
      true,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const resource = body.result.contents[0];
    expect(resource.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.uri).toBe("ui://boardreadyops/review.html");
    expect(resource.text).toContain("BoardReadyOps");
    expect(resource.text).toContain("Source-linked footprint changes");
    expect(resource.text).not.toContain("https://cdn.");
    expect(resource.text).not.toContain("bro_live_");
    expect(fixture.authorizeReview).not.toHaveBeenCalled();
  });

  it("refuses to describe source evidence to malformed review IDs", async () => {
    const fixture = dependencies();
    const response = await handleBoardReadyOpsMcpRequest(
      mcpRequest("tools/call", {
        name: "boardreadyops_review_footprint_summary",
        arguments: { reviewId: "../hidden" },
      }),
      fixture.deps,
      true,
    );
    expect(response.status).toBe(200);
    expect((await response.text()).includes("isError")).toBe(true);
    expect(fixture.authorizeReview).not.toHaveBeenCalled();
  });

  it("does not return restricted paths or CAD messages to an AI caller", async () => {
    const { deps, close } = dependencies();
    const res = await handleBoardReadyOpsMcpRequest(
      mcpRequest("tools/call", {
        name: "boardreadyops_review_findings",
        arguments: { reviewId },
      }),
      deps,
      true,
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("pcb.rule");
    expect(raw).not.toContain("Secret CAD");
    expect(raw).not.toContain("/private/");
    expect(close).toHaveBeenCalled();
  });

  it("does not fetch any review data after repository authorization rejects a forged id", async () => {
    const fixture = dependencies();
    fixture.authorizeReview.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await handleBoardReadyOpsMcpRequest(
      mcpRequest("tools/call", {
        name: "boardreadyops_review_get",
        arguments: { reviewId },
      }),
      fixture.deps,
      true,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("not-found");
    expect(fixture.methods.getReviewById).not.toHaveBeenCalled();
  });

  it("only loads consented footprint evidence tied to the current revision", async () => {
    const fixture = dependencies();
    const res = await handleBoardReadyOpsMcpRequest(
      mcpRequest("tools/call", {
        name: "boardreadyops_review_footprint_summary",
        arguments: { reviewId },
      }),
      fixture.deps,
      true,
    );
    const body = await res.text();
    expect(body).toContain("not-evaluated");
    expect(fixture.loadFootprints).toHaveBeenCalledWith(
      expect.anything(),
      repo,
      runId,
      revision.baseCommitSha,
      revision.headCommitSha,
    );
  });
});
