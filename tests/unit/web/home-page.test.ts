import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import HomePage, { metadata as homeMetadata } from "../../../apps/web/app/page.js";
import { PUBLIC_STRUCTURED_DATA } from "../../../apps/web/components/public-structured-data.js";

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (isValidElement(node)) {
    return collectText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function collectLinks(node: ReactNode, hrefs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectLinks(child, hrefs);
    return hrefs;
  }
  if (isValidElement(node)) {
    const props = node.props as { href?: string; children?: ReactNode; fallback?: ReactNode };
    if (typeof props.href === "string") hrefs.push(props.href);
    // Suspense keeps its fallback in a prop rather than children. The landing page's primary
    // calls to action are session-dependent and live behind one, so a walker that skipped the
    // fallback would report the page as having no primary action at all.
    if (props.fallback !== undefined) collectLinks(props.fallback, hrefs);
    collectLinks(props.children, hrefs);
  }
  return hrefs;
}

describe("HomePage", () => {
  it("publishes homepage-only canonical and Markdown alternate metadata", () => {
    expect(homeMetadata.alternates?.canonical).toBe("/");
    expect(homeMetadata.alternates?.types?.["text/markdown"]).toBe("/index.md");
  });

  it("links visible terminology and the public OpenAPI contract", () => {
    const text = collectText(HomePage());
    const links = collectLinks(HomePage());
    for (const term of ["DRC", "ERC", "BOM", "manufacturing package", "release evidence", "Check Run"]) {
      expect(text).toContain(term);
    }
    expect(text).toContain("Glossary");
    expect(links).toContain("#glossary");
    expect(links).toContain("/openapi.json");
  });

  it("publishes conservative structured data for the visible product", () => {
    const graph = PUBLIC_STRUCTURED_DATA["@graph"] as Array<Record<string, unknown>>;
    expect(graph.map((item) => item["@type"])).toEqual(["WebSite", "SoftwareApplication", "WebPage", "BreadcrumbList"]);
    const webPage = graph.find((item) => item["@type"] === "WebPage");
    expect(webPage).toMatchObject({
      headline: "Catch board mistakes before the fab does.",
      description: expect.any(String),
      url: "https://boardreadyops.com/",
      dateModified: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      breadcrumb: { "@id": "https://boardreadyops.com/#breadcrumbs" },
    });
    const serialized = JSON.stringify(PUBLIC_STRUCTURED_DATA);
    expect(serialized).not.toMatch(/aggregateRating|review|offers|price/);
  });
  it("shows the primary headline", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Catch board mistakes before the fab does.");
  });

  it("shows the three feature-grid headings", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Decision first");
    expect(text).toContain("Finding things");
    expect(text).toContain("Back to the source");
  });

  it("offers a signed-out reader somewhere to install from", () => {
    const links = collectLinks(HomePage());
    const installLinks = links.filter((href) => href === "https://github.com/apps/boardreadyops/installations/new");

    // A signed-in reader gets "Open dashboard" in both of these places instead; asking somebody
    // who already installed to install again is what this page used to do.
    expect(installLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("links the secondary CTA to the setup preview", () => {
    const links = collectLinks(HomePage());
    expect(links).toContain("/setup");
  });

  it("links the landing navigation to product and how-it-works sections", () => {
    const links = collectLinks(HomePage());
    expect(links).toContain("#product");
    expect(links).toContain("#how-it-works");
  });

  it("shows real product proof without fabricated social proof", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Pull request evidence");
    expect(text).toContain("Manufacturing readiness");
    expect(text).toContain("Your repository stays the source of truth");
    expect(text).not.toMatch(/trusted by|customers|teams worldwide|10,000|fortune 500/iu);
  });

  it("links documentation and security assurance from the premium landing navigation", () => {
    const links = collectLinks(HomePage());
    expect(links).toContain("https://docs.boardreadyops.com");
    expect(links).toContain("https://docs.boardreadyops.com/security/assurance-case/");
  });

  it("uses Foundry tokens in landing styles and defines landing-product-proof", async () => {
    const { readFile } = await import("node:fs/promises");
    const landingCss = await readFile("apps/web/app/landing.css", "utf8");
    expect(landingCss).toContain("var(--foundry-canvas)");
    expect(landingCss).toContain("var(--foundry-copper)");
    const page = await readFile("apps/web/app/page.tsx", "utf8");
    expect(page).toContain("landing-product-proof");
    expect(page).not.toMatch(/trusted by|customers|teams worldwide/i);
  });
});
