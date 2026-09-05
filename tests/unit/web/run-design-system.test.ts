import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/app/globals.css", "utf8");

function themeBlock(selector: ":root" | ".dark"): string {
  const pattern = selector === ":root" ? /:root\s*\{([^}]*)\}/su : /\.dark\s*\{([^}]*)\}/su;
  const match = css.match(pattern);
  if (!match?.[1]) throw new Error(`missing ${selector} block in globals.css`);
  return match[1];
}

function variable(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "u"));
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

describe.each([":root", ".dark"] as const)("design tokens in %s meet WCAG AA contrast", (selector) => {
  const block = themeBlock(selector);

  it("keeps body text above 4.5:1 against the page background", () => {
    expect(contrast(variable(block, "foreground"), variable(block, "background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "card-foreground"), variable(block, "card"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every status color above 4.5:1 against its own surface", () => {
    expect(contrast(variable(block, "danger"), variable(block, "danger-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "success"), variable(block, "success-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "warning"), variable(block, "warning-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "info"), variable(block, "info-surface"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("design token declaration", () => {
  it("defines the sharp-corner radius and dark-mode custom variant the ADR locked in", () => {
    expect(css).toContain("--radius: 0.125rem");
    expect(css).toContain("@custom-variant dark");
  });
});
