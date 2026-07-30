import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SetupPage from "../../../apps/web/app/setup/page.js";

async function render(preset?: string): Promise<string> {
  return renderToStaticMarkup(await SetupPage({ searchParams: Promise.resolve(preset ? { preset } : {}) }));
}

async function axeViolations(markup: string): Promise<string[]> {
  const window = new Window({ url: "https://boardreadyops.example/setup" });
  window.document.write(
    `<!doctype html><html lang="en"><head><title>Repository setup</title></head><body>${markup}</body></html>`,
  );
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const keys = ["window", "document", "Node", "Element", "Document", "HTMLElement", "SVGElement"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, globalObject[key]]));
  Object.assign(globalObject, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    Document: window.Document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
  });
  try {
    const axe = (await import("axe-core")).default;
    const result = await axe.run(window.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(globalObject, key);
      else Reflect.set(globalObject, key, value);
    }
    await window.close();
  }
}

describe("repository setup preview page", () => {
  it("renders all presets, exact file paths, least privilege and validation steps", async () => {
    const markup = await render("production");
    expect(markup).toContain("Open-source hardware");
    expect(markup).toContain("Prototype fabrication");
    expect(markup).toContain("Production release");
    expect(markup).toContain("Contract design handoff");
    expect(markup).toContain("boardreadyops.yml");
    expect(markup).toContain(".github/workflows/readiness-runner.yml");
    expect(markup).toContain("Contents: none");
    expect(markup).toContain("GitHub Actions OIDC");
    expect(markup).toContain("releaseMode: production");
    expect(markup).toContain("Enabled findings at medium severity or above");
    expect(markup).toContain("Enabled findings below medium severity");
    expect(markup).toContain("Rules explicitly set to false in the preview");
    expect(markup).not.toContain("installation-token");
  });

  it("falls back safely and has no WCAG A/AA violations", async () => {
    const markup = await render("not-a-preset");
    expect(markup).toContain("Prototype fabrication");
    await expect(axeViolations(markup)).resolves.toEqual([]);
  });
});
