import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SettingsLayout from "../../../apps/web/app/settings/layout.js";
import { ReviewView } from "../../../apps/web/components/review/review-view.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const domGlobalKeys = ["window", "document", "Node", "Element", "Document", "HTMLElement", "SVGElement"] as const;
type DomGlobalKey = (typeof domGlobalKeys)[number];
type DomGlobalSnapshot = Record<DomGlobalKey, unknown>;

function installDomGlobals(window: Window): DomGlobalSnapshot {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(domGlobalKeys.map((key) => [key, globalObject[key]])) as DomGlobalSnapshot;
  Object.assign(globalObject, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    Document: window.Document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
  });
  return previous;
}

function restoreDomGlobals(previous: DomGlobalSnapshot): void {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) Reflect.deleteProperty(globalObject, key);
    else Reflect.set(globalObject, key, value);
  }
}

async function axeViolations(markup: string, path: string): Promise<string[]> {
  const window = new Window({ url: `https://boardreadyops.example${path}` });
  window.document.write(`<!doctype html><html lang="en"><head><title>Test</title></head><body>${markup}</body></html>`);
  const previous = installDomGlobals(window);
  try {
    const axe = (await import("axe-core")).default;
    const result = await axe.run(window.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
  } finally {
    restoreDomGlobals(previous);
    await window.close();
  }
}

describe("Product App Accessibility", () => {
  it("has no WCAG A/AA violations in the review workspace", async () => {
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("review fixture not found");
    const html = renderToStaticMarkup(createElement(ReviewView, { initialReview: review }));
    const violations = await axeViolations(html, `/reviews/${review.id}`);
    expect(violations).toEqual([]);
  });

  it("has no WCAG A/AA violations in the settings layout", async () => {
    const html = renderToStaticMarkup(
      createElement(
        SettingsLayout,
        null,
        createElement("div", { className: "panel" }, createElement("h2", null, "Settings Child")),
      ),
    );
    const violations = await axeViolations(html, "/settings/billing");
    expect(violations).toEqual([]);
  });
});
