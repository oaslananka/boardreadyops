import { describe, expect, it } from "vitest";
import nextConfig from "../../../apps/web/next.config.mjs";

describe("public discovery Next.js routing", () => {
  it("rewrites only Markdown-accepting homepage requests to the Markdown mirror", async () => {
    expect(nextConfig.rewrites).toBeTypeOf("function");
    const rewrites = await nextConfig.rewrites();
    expect(rewrites.beforeFiles).toContainEqual({
      source: "/",
      has: [{ type: "header", key: "accept", value: "(.*)text/markdown(.*)" }],
      destination: "/index.md",
    });
  });

  it("advertises llms.txt only on the public homepage response", async () => {
    const headers = await nextConfig.headers();
    const home = headers.find((entry) => entry.source === "/");
    const link = home?.headers.find((header) => header.key === "Link")?.value;
    expect(link).toContain('<https://boardreadyops.com/>; rel="canonical"');
    expect(link).toContain('</llms.txt>; rel="describedby"');
    const setup = headers.find((entry) => entry.source === "/setup");
    expect(setup?.headers).not.toContainEqual(expect.objectContaining({ key: "Link" }));
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
});
