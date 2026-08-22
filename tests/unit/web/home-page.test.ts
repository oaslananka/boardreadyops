import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import HomePage from "../../../apps/web/app/page.js";

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
    const props = node.props as { href?: string; children?: ReactNode };
    if (typeof props.href === "string") hrefs.push(props.href);
    collectLinks(props.children, hrefs);
  }
  return hrefs;
}

describe("HomePage", () => {
  it("shows the primary headline", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Release evidence that leads to a decision.");
  });

  it("shows the three feature-grid headings from the existing copy", () => {
    const text = collectText(HomePage());
    expect(text).toContain("Decision first");
    expect(text).toContain("Bounded investigation");
    expect(text).toContain("Authoritative sources");
  });

  it("links every Install on GitHub CTA to the App install URL", () => {
    const links = collectLinks(HomePage());
    const installLinks = links.filter((href) => href === "https://github.com/apps/boardreadyops/installations/new");
    expect(installLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("links the secondary CTA to the setup preview", () => {
    const links = collectLinks(HomePage());
    expect(links).toContain("/setup");
  });
});
