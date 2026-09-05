import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SetupPage from "../../../apps/web/app/setup/page.js";

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await SetupPage({ searchParams: Promise.resolve(searchParams) }));
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
    const markup = await render({ preset: "production" });
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

  it("treats the GitHub setup redirect as an untrusted installation handoff", async () => {
    const markup = await render({
      installation_id: "123456789",
      setup_action: "install",
    });
    expect(markup).toContain("GitHub App installation handoff");
    expect(markup).toContain("untrusted redirect parameter");
    expect(markup).toContain("does not authorize repository access");
    expect(markup).toContain("Continue with repository setup");
    expect(markup).not.toContain("123456789");
  });

  it("presents setup as a three-step guided journey", async () => {
    const markup = await render({ preset: "prototype" });
    expect(markup).toContain("1. Choose a release policy");
    expect(markup).toContain("2. Review repository-owned files");
    expect(markup).toContain("3. Validate readiness in GitHub Actions");
    expect(markup).toContain('href="#policy-preset"');
    expect(markup).toContain('href="#proposed-files"');
    expect(markup).toContain('href="#readiness"');
  });

  it("emphasizes configuration preview honesty and explicit recovery actions", async () => {
    const markup = await render({ preset: "prototype" });
    expect(markup).toContain("Configuration preview only");
    expect(markup).toContain("Recovery and troubleshooting");
  });

  it("keeps the scrollable configuration preview natively keyboard focusable", async () => {
    const markup = await render({ preset: "production" });
    expect(markup).toContain("setup-code-preview");
    expect(markup).toContain('aria-labelledby="setup-config-preview-caption"');
    expect(markup).toContain('readOnly=""');
  });

  it("falls back safely and has no WCAG A/AA violations", async () => {
    const markup = await render({ preset: "not-a-preset" });
    expect(markup).toContain("Prototype fabrication");
    await expect(axeViolations(markup)).resolves.toEqual([]);
  });
});
