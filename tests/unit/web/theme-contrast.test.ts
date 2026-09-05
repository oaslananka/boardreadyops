import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Contrast cover for the palette.
 *
 * Checks all core text and status color tokens in globals.css for WCAG AA compliance
 * across both light (:root) and dark (.dark) themes.
 */

const css = await readFile("apps/web/app/globals.css", "utf8");

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

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function parse(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const packed = Number.parseInt(hex, 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 1];
  }
  throw new Error(`cannot parse colour ${color}`);
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(foreground: string, background: string): number {
  const [fr, fg, fb] = parse(foreground);
  const [br, bg, bb] = parse(background);
  const front = luminance([fr, fg, fb]);
  const back = luminance([br, bg, bb]);
  const [high, low] = front > back ? [front, back] : [back, front];
  return (high + 0.05) / (low + 0.05);
}

describe.each([":root", ".dark"] as const)("globals.css palette contrast in %s", (selector) => {
  const block = themeBlock(selector);

  it("keeps core text pairs at WCAG AA", () => {
    expect(contrast(variable(block, "foreground"), variable(block, "background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "card-foreground"), variable(block, "card"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "muted-foreground"), variable(block, "background"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps status colors visible against their surfaces", () => {
    expect(contrast(variable(block, "danger"), variable(block, "danger-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "success"), variable(block, "success-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "warning"), variable(block, "warning-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "info"), variable(block, "info-surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("declares custom variant dark for styling", () => {
    expect(css).toContain("@custom-variant dark");
  });
});
