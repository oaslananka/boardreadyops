import fs from "node:fs";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync("docs/stylesheets/accessibility.css", "utf8");
const accessibilityDocumentation = fs.readFileSync("docs/accessibility.md", "utf8");
const selfHostedDocumentation = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");

describe("documentation accessibility regressions", () => {
  it("keeps nav color overrides scoped to Material color schemes", () => {
    expect(css).not.toMatch(/^\.md-nav__link\s*\{/m);
    expect(css).toContain(`[data-md-color-scheme="default"] .md-nav__link`);
    expect(css).toContain(`[data-md-color-scheme="slate"] .md-nav__link`);
    expect(css).toContain(`[data-md-color-scheme="slate"] .md-nav__link:is(:focus, :hover)`);
    expect(css).toContain(`[data-md-color-scheme="slate"] .md-nav__link--active`);
  });

  it("keeps dark-mode nav and TOC colors above WCAG AA contrast", () => {
    expect(contrastRatio("#e5e7eb", "#111827")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#bfdbfe", "#111827")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#d1d5db", "#111827")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", "#1f2937")).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(".md-header .md-source__fact");
  });

  it("keeps the BoardReadyOps docs dark-scheme brand colors above WCAG AA contrast", () => {
    expect(contrastRatio("#f4fff8", "#070d0a")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#5cf5a0", "#070d0a")).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain("--md-default-bg-color: var(--bro-docs-bg)");
    expect(css).toContain("--md-default-fg-color: var(--bro-docs-text)");
    expect(css).toContain("--md-accent-fg-color: var(--bro-docs-accent)");
  });

  it("documents the hosted investigation accessibility and bounded-data contract", () => {
    expect(accessibilityDocumentation).toContain("hosted Next.js run investigation");
    expect(accessibilityDocumentation).toContain("Status and severity always include a visible text label and an icon");
    expect(accessibilityDocumentation).toContain("server-side, parameterized filtering and bounded pagination");
    expect(accessibilityDocumentation).toContain("run-investigation-accessibility.test.ts");
    expect(accessibilityDocumentation).toContain("run-design-system.test.ts");
    expect(accessibilityDocumentation).toContain("structural visual-regression coverage");
    expect(selfHostedDocumentation).toContain("summary, attempts, findings, artifacts, publication, and audit routes");
    expect(selfHostedDocumentation).toContain("bounded PostgreSQL queries");
    expect(selfHostedDocumentation).toContain("operator-authenticated export");
  });

  it("keeps the public docs navigation grouped into a small set of top-level tabs", () => {
    const config = yaml.load(fs.readFileSync("mkdocs.yml", "utf8")) as { nav: Array<Record<string, unknown>> };
    expect(config.nav).toHaveLength(5);
    expect(config.nav.map((entry) => Object.keys(entry)[0])).toEqual([
      "Start",
      "Use",
      "Hardware Gates",
      "Operations",
      "Reference",
    ]);
  });
});

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  const linear = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function rgb(hex: string): [number, number, number] {
  const channels = hex.replace("#", "").match(/.{2}/g);
  if (channels?.length !== 3) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  const [red, green, blue] = channels as [string, string, string];
  return [parseInt(red, 16) / 255, parseInt(green, 16) / 255, parseInt(blue, 16) / 255];
}
