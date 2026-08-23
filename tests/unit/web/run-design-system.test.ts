import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/app/styles.css", "utf8");

function variable(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "u"));
  if (!match?.[1]) throw new Error(`missing color token --${name}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map((value) => Number.parseInt(value, 16) / 255);
  if (channels?.length !== 3) throw new Error(`invalid color ${hex}`);
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("hosted dashboard design system", () => {
  it("keeps raw color values inside the token declaration", () => {
    const withoutTokens = css.replace(/:root\s*\{[\s\S]*?\}/u, "");
    const rawColorPattern = /#[0-9a-fA-F]{3,8}(?![0-9A-Za-z_-])|rgba?\(/u;
    expect(".sample { color: #fff; }").toMatch(rawColorPattern);
    expect("#decision { color: var(--bro-text); }").not.toMatch(rawColorPattern);
    expect(withoutTokens).not.toMatch(rawColorPattern);
    expect(css).toContain("--bro-bg:");
    expect(css).toContain("--bro-surface:");
    expect(css).toContain("--bro-accent:");
    expect(css).toContain("--bro-text:");
    expect(css).toContain("--bro-motion-fast:");
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain("--space-7");
    expect(css).toContain("--radius-lg");
    expect(css).toContain("--focus");
  });

  it("keeps semantic status text above WCAG AA contrast", () => {
    expect(contrast(variable("bro-text"), variable("bro-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable("bro-text-muted"), variable("bro-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable("bro-text-subtle"), variable("bro-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable("success"), variable("success-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable("warning"), variable("warning-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable("danger"), variable("danger-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable("info"), variable("info-surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("provides visible focus, responsive tables, and reduced-motion behavior", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 0.2rem solid var(--focus)");
    expect(css).toContain(".table-scroll");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none");
  });
});
