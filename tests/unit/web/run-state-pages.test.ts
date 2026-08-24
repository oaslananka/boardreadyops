import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "../../../apps/web/app/error.js";
import NotFound from "../../../apps/web/app/not-found.js";
import RunError from "../../../apps/web/app/runs/[runId]/error.js";
import LoadingRun from "../../../apps/web/app/runs/[runId]/loading.js";
import RunNotFound from "../../../apps/web/app/runs/[runId]/not-found.js";

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
  window.document.write(
    `<!doctype html><html lang="en"><head><title>BoardReadyOps</title></head><body>${markup}</body></html>`,
  );
  const previous = installDomGlobals(window);
  try {
    const axe = (await import("axe-core")).default;
    const result = await axe.run(window.document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
  } finally {
    restoreDomGlobals(previous);
    await window.close();
  }
}

describe("run route state pages", () => {
  it("renders loading inside the shared premium state surface", () => {
    const loadingMarkup = renderToStaticMarkup(createElement(LoadingRun));

    expect(loadingMarkup).toContain("Loading run investigation");
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain("run-state-surface");
  });

  it("renders run-level not-found inside the shared premium state surface", () => {
    const notFoundMarkup = renderToStaticMarkup(createElement(RunNotFound));

    expect(notFoundMarkup).toContain("Run not found or no longer available");
    expect(notFoundMarkup).toContain("Return home");
    expect(notFoundMarkup).toContain("run-state-surface");
  });

  it("renders root not-found with UTF-8 dash and returns home", () => {
    const rootNotFoundMarkup = renderToStaticMarkup(createElement(NotFound));

    expect(rootNotFoundMarkup).toContain("404 — Page not found");
    expect(rootNotFoundMarkup).toContain("Return to home");
    expect(rootNotFoundMarkup).toContain("run-state-surface");
  });

  it("keeps error privacy copy, support digest, and retry action on run-level error", () => {
    const reset = vi.fn();
    const errorMarkup = renderToStaticMarkup(
      createElement(RunError, { error: Object.assign(new Error("internal"), { digest: "support-ref" }), reset }),
    );

    expect(errorMarkup).toContain("Run investigation could not be loaded");
    expect(errorMarkup).toContain("without exposing database or tenant details");
    expect(errorMarkup).toContain("support-ref");
    expect(errorMarkup).toContain("Retry");
    expect(errorMarkup).toContain("run-state-surface");
    expect(errorMarkup).not.toContain("internal");
  });

  it("renders root application error safely with opaque diagnostic reference", () => {
    const reset = vi.fn();
    const errorMarkup = renderToStaticMarkup(
      createElement(GlobalError, {
        error: Object.assign(new Error("sensitive SQL connection leak"), { digest: "diag-abc-123" }),
        reset,
      }),
    );

    expect(errorMarkup).toContain("Application error");
    expect(errorMarkup).toContain("An unexpected error occurred while loading this page.");
    expect(errorMarkup).toContain("diag-abc-123");
    expect(errorMarkup).toContain("Retry");
    expect(errorMarkup).toContain("run-state-surface");
    expect(errorMarkup).not.toContain("sensitive SQL connection leak");
  });

  it("has zero Axe WCAG A/AA violations on root NotFound and GlobalError pages", async () => {
    const notFoundMarkup = renderToStaticMarkup(createElement(NotFound));
    const errorMarkup = renderToStaticMarkup(
      createElement(GlobalError, {
        error: Object.assign(new Error("error"), { digest: "diag-1" }),
        reset: () => {},
      }),
    );

    await expect(axeViolations(notFoundMarkup, "/not-found")).resolves.toEqual([]);
    await expect(axeViolations(errorMarkup, "/error")).resolves.toEqual([]);
  });
});
