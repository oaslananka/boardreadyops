import { describe, expect, it } from "vitest";
import robots from "../../../apps/web/app/robots.js";
import nextConfig from "../../../apps/web/next.config.mjs";
import { proxy, config as proxyConfig, wantsMarkdown } from "../../../apps/web/proxy.js";

describe("public discovery Next.js routing", () => {
  it("runs the request-aware proxy only for the public homepage", () => {
    expect(proxyConfig).toEqual({ matcher: ["/"] });
  });

  it("honors Markdown Accept quality instead of substring matching", () => {
    expect(wantsMarkdown("text/markdown")).toBe(true);
    expect(wantsMarkdown("text/html, text/markdown;q=0.8")).toBe(true);
    expect(wantsMarkdown("text/markdown;q=0")).toBe(false);
    expect(wantsMarkdown("text/html, text/markdown;q=0")).toBe(false);
    expect(wantsMarkdown("text/markdown;q=bogus")).toBe(false);
    expect(wantsMarkdown("text/markdown;q=0.5junk")).toBe(false);
    expect(wantsMarkdown("text/html")).toBe(false);
    expect(wantsMarkdown(null)).toBe(false);
  });

  it("rewrites only accepted Markdown representations and advertises correct variance", async () => {
    const markdown = await proxy({
      headers: new Headers({ accept: "text/html, text/markdown;q=0.5" }),
      nextUrl: new URL("https://boardreadyops.com/"),
      method: "GET",
      url: "https://boardreadyops.com/",
    } as never);
    expect(markdown.headers.get("x-middleware-rewrite")).toBe("https://boardreadyops.com/index.md");
    expect(markdown.headers.get("link")).toContain('<https://boardreadyops.com/>; rel="canonical"');
    expect(markdown.headers.get("link")).toContain('</llms.txt>; rel="describedby"');
    expect(
      markdown.headers
        .get("vary")
        ?.split(",")
        .map((value) => value.trim().toLowerCase()),
    ).toContain("accept");

    const html = await proxy({
      headers: new Headers({ accept: "text/html, text/markdown;q=0" }),
      nextUrl: new URL("https://boardreadyops.com/"),
      method: "GET",
      url: "https://boardreadyops.com/",
    } as never);
    expect(html.headers.get("x-middleware-rewrite")).toBeNull();
    expect(
      html.headers
        .get("vary")
        ?.split(",")
        .map((value) => value.trim().toLowerCase()),
    ).toContain("accept");

    const mutation = await proxy({
      headers: new Headers({ accept: "text/markdown" }),
      nextUrl: new URL("https://boardreadyops.com/"),
      method: "POST",
      url: "https://boardreadyops.com/",
    } as never);
    expect(mutation.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("keeps request-aware homepage routing out of static next.config rewrites", async () => {
    expect(nextConfig.rewrites).toBeUndefined();
    const headers = await nextConfig.headers();
    expect(headers.find((entry) => entry.source === "/")).toBeUndefined();
  });

  it("marks application page families noindex without affecting public discovery", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const headers = await nextConfig.headers();
    const noindexSources = headers
      .filter((entry) => entry.headers.some((header) => header.key === "X-Robots-Tag"))
      .map((entry) => entry.source);
    expect(noindexSources).toEqual([
      "/setup",
      "/dashboard",
      "/work",
      "/evidence",
      "/insights",
      "/policies",
      "/repositories/:path*",
      "/reviews/:path*",
      "/runs/:path*",
      "/settings/:path*",
    ]);
    expect(noindexSources).not.toContain("/");
    expect(noindexSources).not.toContain("/llms.txt");
    expect(noindexSources).not.toContain("/openapi.json");
  });

  it("keeps crawler discovery public while excluding API and private application families", () => {
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual([
      "/api/",
      "/setup",
      "/dashboard",
      "/work",
      "/evidence",
      "/insights",
      "/policies",
      "/repositories/",
      "/reviews/",
      "/runs/",
      "/settings/",
    ]);
    expect(result.sitemap).toContain("https://boardreadyops.com/sitemap.xml");
  });
});
