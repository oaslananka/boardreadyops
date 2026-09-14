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
  it("renders all presets, exact file paths, the declared permission profile and validation steps", async () => {
    const markup = await render({ preset: "production" });
    expect(markup).toContain("Open-source hardware");
    expect(markup).toContain("Prototype fabrication");
    expect(markup).toContain("Production release");
    expect(markup).toContain("Contract design handoff");
    expect(markup).toContain("boardreadyops.yml");
    expect(markup).toContain(".github/workflows/readiness-runner.yml");
    // The page renders the profile declared in cloud-core rather than its own copy of the list,
    // which is what previously let it advertise `Contents: none` while the setup API and the
    // mutation service were both built for `contents: write`.
    expect(markup).toContain("Contents");
    expect(markup).toContain("never to the default branch");
    expect(markup).not.toContain("Contents: none");
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

  it("presents setup as a four-step guided journey ending at a real pull request", async () => {
    const markup = await render({ preset: "prototype" });
    expect(markup).toContain("1. Choose a release policy");
    expect(markup).toContain("2. Review repository-owned files");
    expect(markup).toContain("3. Open the pull request");
    expect(markup).toContain("4. Validate readiness in GitHub Actions");
    expect(markup).toContain('href="#policy-preset"');
    expect(markup).toContain('href="#proposed-files"');
    expect(markup).toContain('href="#automated-setup"');
    expect(markup).toContain('href="#readiness"');
  });

  it("offers the one-click step to a signed-out visitor instead of hiding it", async () => {
    const markup = await render({ preset: "prototype" });
    // The panel used to render only when an installation and repository were both passed, and
    // the only caller passed neither, so the zero-touch promise had no entry point at all.
    expect(markup).toContain("3. Open the setup pull request");
    expect(markup).toContain("Sign in with GitHub");
    expect(markup).toContain("commit them yourself");
  });

  it("gives every preset selection action a 44px mobile touch target", async () => {
    const markup = await render({ preset: "prototype" });
    const window = new Window({ url: "https://boardreadyops.example/setup" });
    window.document.write(markup);
    const presetLinks = [...window.document.querySelectorAll<HTMLAnchorElement>('a[href^="/setup?preset="]')];

    expect(presetLinks).toHaveLength(4);
    for (const link of presetLinks) {
      expect(link.classList.contains("min-h-11")).toBe(true);
    }
    await window.close();
  });

  it("says what is written and where it cannot be written, plus explicit recovery actions", async () => {
    const markup = await render({ preset: "prototype" });
    expect(markup).toContain("Read the files before you decide");
    expect(markup).toContain("never a commit to your default");
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
