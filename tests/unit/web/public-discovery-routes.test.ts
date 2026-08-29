import { describe, expect, it } from "vitest";
import { GET as getAgents } from "../../../apps/web/app/AGENTS.md/route.js";
import { GET as getLlms } from "../../../apps/web/app/llms.txt/route.js";
import { GET as getLlmsFull } from "../../../apps/web/app/llms-full.txt/route.js";
import { GET as getOpenApi } from "../../../apps/web/app/openapi.json/route.js";
import robots from "../../../apps/web/app/robots.js";
import sitemap from "../../../apps/web/app/sitemap.js";
import { GET as getSitemapMarkdown } from "../../../apps/web/app/sitemap.md/route.js";

describe("public discovery routes", () => {
  it("serves llms.txt as cacheable plain text", async () => {
    const response = getLlms();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(await response.text()).toContain("# BoardReadyOps");
  });

  it("serves llms-full.txt as bounded plain text", async () => {
    const response = getLlmsFull();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect((await response.text()).length).toBeGreaterThan(1_000);
  });

  it("serves markdown sitemap and public agent guidance", async () => {
    const sitemapResponse = getSitemapMarkdown();
    const agentsResponse = getAgents();
    expect(sitemapResponse.status).toBe(200);
    expect(sitemapResponse.headers.get("content-type")).toContain("text/markdown");
    expect(await sitemapResponse.text()).toContain("# BoardReadyOps Sitemap");
    expect(agentsResponse.headers.get("cache-control")).toContain("public");
    expect(await agentsResponse.text()).toContain("## Installation");
  });

  it("serves the public OpenAPI document as JSON", async () => {
    const response = getOpenApi();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths).sort()).toEqual(["/api/health/live", "/api/health/ready"]);
  });

  it("declares crawlable discovery resources and the XML sitemap", () => {
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(result.sitemap).toContain("https://boardreadyops.com/sitemap.xml");
  });

  it("publishes only the canonical homepage in the XML sitemap", () => {
    const result = sitemap();
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://boardreadyops.com/");
    expect(result[0]?.lastModified).toBeInstanceOf(Date);
  });
});
