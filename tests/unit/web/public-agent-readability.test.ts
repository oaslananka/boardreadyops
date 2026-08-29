import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GET as getHomeMarkdown } from "../../../apps/web/app/index.md/route.js";
import { metadata as layoutMetadata } from "../../../apps/web/app/layout.js";
import HomePage, { metadata as homeMetadata } from "../../../apps/web/app/page.js";
import { PUBLIC_STRUCTURED_DATA } from "../../../apps/web/components/public-structured-data.js";
import { buildHomeMarkdown } from "../../../apps/web/lib/public-discovery-content.js";
import nextConfig from "../../../apps/web/next.config.mjs";
import { visibleTextRatio } from "../../../scripts/verify-public-agent-readability.mjs";

describe("public agent readability contract", () => {
  it("keeps search metadata and language semantics explicit", () => {
    expect(layoutMetadata.description?.length).toBeGreaterThanOrEqual(50);
    expect(layoutMetadata.openGraph?.title).toBeTruthy();
    expect(layoutMetadata.openGraph?.description).toBeTruthy();
    expect(homeMetadata.alternates?.canonical).toBe("/");
    expect(homeMetadata.alternates?.types?.["text/markdown"]).toBe("/index.md");
    expect(readFileSync("apps/web/app/layout.tsx", "utf8")).toContain('<html lang="en"');
  });

  it("keeps the visible homepage semantically rich and glossary-linked", () => {
    const html = renderToStaticMarkup(HomePage());
    const window = new Window({ url: "https://boardreadyops.com/" });
    window.document.write(html);
    expect(window.document.querySelectorAll("h1,h2,h3,h4,h5,h6").length).toBeGreaterThanOrEqual(3);
    expect(window.document.querySelector('a[href="#glossary"]')?.textContent).toMatch(/glossary|terminology/i);
    expect(window.document.querySelector('a[href="/openapi.json"]')).not.toBeNull();
    expect(visibleTextRatio(html)).toBeGreaterThan(0.15);
  });

  it("keeps structured data conservative and parseable", () => {
    const graph = PUBLIC_STRUCTURED_DATA["@graph"];
    expect(graph.map((entry) => entry["@type"])).toEqual([
      "WebSite",
      "SoftwareApplication",
      "WebPage",
      "BreadcrumbList",
    ]);
    expect(JSON.stringify(PUBLIC_STRUCTURED_DATA)).not.toMatch(/aggregateRating|review|offers|price/);
  });

  it("keeps the Markdown representation self-describing", async () => {
    const markdown = buildHomeMarkdown();
    expect(markdown).toMatch(/^---\n[\s\S]*?\n---\n/);
    expect(markdown).toContain("canonical_url:");
    expect(markdown).toContain("## Sitemap");
    for (const fence of markdown.matchAll(/^```(.*)$/gm)) expect(fence[1]?.trim().length).toBeGreaterThan(0);

    const response = getHomeMarkdown();
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("link")).toBe('<https://boardreadyops.com/>; rel="canonical"');
    expect(response.headers.get("vary")).toContain("Accept");
  });

  it("advertises llms discovery on the homepage response only", async () => {
    const headers = await nextConfig.headers();
    const link = headers.find((entry) => entry.source === "/")?.headers.find((header) => header.key === "Link")?.value;
    expect(link).toContain('<https://boardreadyops.com/>; rel="canonical"');
    expect(link).toContain('</llms.txt>; rel="describedby"');
  });

  it("keeps public-discovery verification explicit for static analyzers", () => {
    const verifier = readFileSync("scripts/verify-public-agent-readability.mjs", "utf8");
    const structuredData = readFileSync("apps/web/components/public-structured-data.tsx", "utf8");

    expect(verifier).not.toContain("String(lastError)");
    expect(verifier).not.toContain("lastError ? `:");
    expect(verifier).toContain('.startsWith("3.1.")');
    expect(verifier).toContain(".sort((left, right) => left.localeCompare(right))");
    expect(verifier).not.toContain("main().catch(");
    expect(structuredData).toContain("String.raw`\\u003c`");
  });

  it("wires the post-build verifier into the cloud build contract", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["verify:public-agent-readability"]).toBe("node scripts/verify-public-agent-readability.mjs");
    expect(pkg.scripts["cloud:build"]).toContain("verify:public-agent-readability");
  });
});
