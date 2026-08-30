import { describe, expect, it } from "vitest";
import edgeWorker, {
  canonicalPathForMirror,
  handleDocsEdgeRequest,
  markdownMirrorPath,
  wantsMarkdown,
} from "../../../scripts/docs-agent-edge-worker.mjs";

const DOCS_ORIGIN = "https://docs.boardreadyops.com";

function request(path: string, init?: RequestInit) {
  return new Request(`${DOCS_ORIGIN}${path}`, init);
}

function originFixture() {
  const calls: Request[] = [];
  const fetchOrigin = async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push(req);
    const url = new URL(req.url);

    if (url.pathname === "/quickstart.md") {
      return new Response("# Quickstart\n", {
        status: 200,
        headers: { "content-type": "text/plain", etag: '"quickstart-v1"' },
      });
    }
    if (url.pathname === "/sitemap.md") {
      return new Response("# Sitemap\n", { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (url.pathname === "/missing.md") {
      return new Response("missing mirror", { status: 404, headers: { "content-type": "text/html" } });
    }
    return new Response(`<html><body>${url.pathname}</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", vary: "Accept-Encoding", etag: '"html-v1"' },
    });
  };
  return { calls, fetchOrigin };
}

describe("docs agent edge worker helpers", () => {
  it("recognizes Markdown negotiation only for safe read methods", () => {
    expect(wantsMarkdown(request("/quickstart/", { headers: { accept: "text/html, text/markdown" } }))).toBe(true);
    expect(wantsMarkdown(request("/quickstart/", { method: "HEAD", headers: { accept: "text/markdown" } }))).toBe(true);
    expect(wantsMarkdown(request("/quickstart/", { headers: { accept: "text/html" } }))).toBe(false);
    expect(wantsMarkdown(request("/quickstart/", { headers: { accept: "text/markdown;q=0" } }))).toBe(false);
    expect(wantsMarkdown(request("/quickstart/", { method: "POST", headers: { accept: "text/markdown" } }))).toBe(
      false,
    );
  });

  it("maps canonical documentation paths to raw Markdown mirrors", () => {
    expect(markdownMirrorPath("/")).toBe("/index.md");
    expect(markdownMirrorPath("/quickstart/")).toBe("/quickstart.md");
    expect(markdownMirrorPath("/quickstart")).toBe("/quickstart.md");
    expect(markdownMirrorPath("/rules/bom/")).toBe("/rules/bom.md");
    expect(markdownMirrorPath("/assets/styles.css")).toBeNull();
    expect(markdownMirrorPath("/images/logo.svg")).toBeNull();
    expect(markdownMirrorPath("/quickstart.md")).toBeNull();
  });

  it("maps Markdown mirrors back to their canonical HTML paths", () => {
    expect(canonicalPathForMirror("/index.md")).toBe("/");
    expect(canonicalPathForMirror("/quickstart.md")).toBe("/quickstart/");
    expect(canonicalPathForMirror("/rules/bom.md")).toBe("/rules/bom/");
    expect(canonicalPathForMirror("/reference/plugin-sdk/README.md")).toBe("/reference/plugin-sdk/");
    expect(canonicalPathForMirror("/AGENTS.md")).toBeNull();
    expect(canonicalPathForMirror("/sitemap.md")).toBeNull();
    expect(canonicalPathForMirror("/assets/styles.css")).toBeNull();
  });
});

describe("docs agent edge worker responses", () => {
  it("passes ordinary HTML through while advertising llms discovery and Accept variance", async () => {
    const { calls, fetchOrigin } = originFixture();
    const response = await handleDocsEdgeRequest(request("/quickstart/"), fetchOrigin);

    expect(await response.text()).toContain("/quickstart/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("etag")).toBe('"html-v1"');
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
    expect(response.headers.get("link")).toContain('<https://docs.boardreadyops.com/llms.txt>; rel="describedby"');
    expect(calls.map((call) => call.url)).toEqual(["https://docs.boardreadyops.com/quickstart/"]);
  });

  it("serves the same-host Markdown mirror for negotiated documentation requests", async () => {
    const { calls, fetchOrigin } = originFixture();
    const response = await handleDocsEdgeRequest(
      request("/quickstart/?source=agent", { headers: { accept: "text/markdown" } }),
      fetchOrigin,
    );

    expect(await response.text()).toBe("# Quickstart\n");
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("etag")).toBe('"quickstart-v1"');
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("link")).toContain('<https://docs.boardreadyops.com/quickstart/>; rel="canonical"');
    expect(response.headers.get("link")).toContain('<https://docs.boardreadyops.com/llms.txt>; rel="describedby"');
    expect(calls.map((call) => call.url)).toEqual(["https://docs.boardreadyops.com/quickstart.md?source=agent"]);
  });

  it("adds canonical and discovery Link headers to direct Markdown mirror responses", async () => {
    const { fetchOrigin } = originFixture();
    const response = await handleDocsEdgeRequest(request("/quickstart.md"), fetchOrigin);

    expect(await response.text()).toBe("# Quickstart\n");
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("link")).toContain('<https://docs.boardreadyops.com/quickstart/>; rel="canonical"');
    expect(response.headers.get("link")).toContain('<https://docs.boardreadyops.com/llms.txt>; rel="describedby"');
  });

  it("normalizes non-page discovery Markdown without inventing an HTML canonical", async () => {
    const { fetchOrigin } = originFixture();
    const response = await handleDocsEdgeRequest(request("/sitemap.md"), fetchOrigin);

    expect(await response.text()).toBe("# Sitemap\n");
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("link")).toBe('<https://docs.boardreadyops.com/llms.txt>; rel="describedby"');
  });

  it("falls back to the original HTML request when a negotiated mirror is absent", async () => {
    const { calls, fetchOrigin } = originFixture();
    const response = await handleDocsEdgeRequest(
      request("/missing/?from=https%3A%2F%2Fevil.example", { headers: { accept: "text/markdown" } }),
      fetchOrigin,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/missing/");
    expect(calls.map((call) => call.url)).toEqual([
      "https://docs.boardreadyops.com/missing.md?from=https%3A%2F%2Fevil.example",
      "https://docs.boardreadyops.com/missing/?from=https%3A%2F%2Fevil.example",
    ]);
    expect(calls.every((call) => new URL(call.url).origin === DOCS_ORIGIN)).toBe(true);
  });

  it("rejects requests for any hostname outside the canonical docs origin", async () => {
    const { calls, fetchOrigin } = originFixture();
    const response = await handleDocsEdgeRequest(
      new Request("https://attacker.example/quickstart/", { headers: { accept: "text/markdown" } }),
      fetchOrigin,
    );

    expect(response.status).toBe(421);
    expect(calls).toHaveLength(0);
  });

  it("never rewrites asset or mutation requests to Markdown", async () => {
    const asset = originFixture();
    await handleDocsEdgeRequest(request("/assets/app.js", { headers: { accept: "text/markdown" } }), asset.fetchOrigin);
    expect(asset.calls.map((call) => new URL(call.url).pathname)).toEqual(["/assets/app.js"]);

    const mutation = originFixture();
    await handleDocsEdgeRequest(
      request("/quickstart/", { method: "POST", body: "payload", headers: { accept: "text/markdown" } }),
      mutation.fetchOrigin,
    );
    expect(mutation.calls.map((call) => new URL(call.url).pathname)).toEqual(["/quickstart/"]);
  });

  it("exports a Cloudflare module handler that uses the same request policy", async () => {
    expect(typeof edgeWorker.fetch).toBe("function");
  });
});
