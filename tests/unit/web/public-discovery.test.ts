import { describe, expect, it } from "vitest";
import {
  CURATED_DOC_LINKS,
  DOCS_ORIGIN,
  PUBLIC_API_PATHS,
  PUBLIC_HTML_PAGES,
  PUBLIC_SITE_ORIGIN,
} from "../../../apps/web/lib/public-discovery.js";
import {
  buildHomeMarkdown,
  buildLlmsFullTxt,
  buildLlmsTxt,
  buildPublicAgentsMarkdown,
  buildSitemapMarkdown,
} from "../../../apps/web/lib/public-discovery-content.js";

describe("public discovery manifest", () => {
  it("publishes only the approved canonical surfaces", () => {
    expect(PUBLIC_SITE_ORIGIN).toBe("https://boardreadyops.com");
    expect(DOCS_ORIGIN).toBe("https://docs.boardreadyops.com");
    expect(PUBLIC_HTML_PAGES).toEqual([{ path: "/", markdownPath: "/index.md" }]);
    expect(PUBLIC_API_PATHS).toEqual(["/api/health/live", "/api/health/ready"]);
  });

  it("keeps curated links on canonical public origins", () => {
    for (const item of CURATED_DOC_LINKS) {
      const url = new URL(item.url);
      expect([PUBLIC_SITE_ORIGIN, DOCS_ORIGIN]).toContain(url.origin);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }
  });
});

describe("public discovery content", () => {
  it("builds llmstxt.org-compatible discovery markdown", () => {
    const text = buildLlmsTxt();
    expect(text.startsWith("# BoardReadyOps\n\n> ")).toBe(true);
    expect(text).toContain("\n## Documentation\n");
    expect(text).toContain("\n## Optional\n");
    expect(text).toContain("https://docs.boardreadyops.com/");
    expect(text).not.toMatch(/\/runs\/|\/reviews\/|\/settings\/|\/api\/v1\/runner\//);
  });

  it("gives markdown mirrors frontmatter and sitemap discovery", () => {
    const text = buildHomeMarkdown();
    expect(text).toMatch(/^---\ntitle: BoardReadyOps/m);
    expect(text).toContain('canonical_url: "https://boardreadyops.com/"');
    expect(text).toContain("\n## Sitemap\n");
    expect(text).toContain("https://boardreadyops.com/sitemap.md");
  });

  it("keeps public AGENTS guidance separate from repository operations", () => {
    const text = buildPublicAgentsMarkdown();
    expect(text).toContain("## Installation");
    expect(text).toContain("## Configuration");
    expect(text).toContain("## Usage");
    expect(text).not.toMatch(/REPOLAR_OPS|exec-agent|sudo|DATABASE_URL|GITHUB_WEBHOOK_SECRET/);
  });

  it("builds a bounded full context file", () => {
    const text = buildLlmsFullTxt();
    expect(text.length).toBeGreaterThan(1_000);
    expect(text.length).toBeLessThan(20_000);
  });

  it("builds a semantic markdown sitemap", () => {
    const text = buildSitemapMarkdown();
    expect(text.startsWith("# BoardReadyOps Sitemap"));
    expect(text).toContain("## Product");
    expect(text).toContain("## Documentation");
  });
});
