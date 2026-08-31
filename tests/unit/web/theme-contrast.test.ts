import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Contrast cover for the palette.
 *
 * The accessibility suite renders markup without the stylesheet, so axe has no colours to
 * measure and cannot see a theme regression at all. These read the tokens straight out of the
 * stylesheet and do the WCAG arithmetic, which is the only place the (single, dark) theme is
 * held to a contrast floor rather than to how it looks.
 */

const stylesheet = await readFile("apps/web/app/styles.css", "utf8");

const DARK = ":root {";

function declarations(selector: string): Map<string, string> {
  const start = stylesheet.indexOf(selector);
  if (start < 0) throw new Error(`stylesheet has no ${selector} block`);
  // Count braces rather than look for a particular indentation, so a block nested inside a
  // media query is read the same way as one at the top level.
  const open = stylesheet.indexOf("{", start);
  let depth = 0;
  let close = open;
  for (let index = open; index < stylesheet.length; index += 1) {
    const character = stylesheet[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  const found = new Map<string, string>();
  for (const line of stylesheet.slice(open + 1, close).split("\n")) {
    const [, name, value] = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);/i.exec(line) ?? [];
    if (name && value) found.set(name, value.trim());
  }
  return found;
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
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(color)?.[1];
  if (rgba === undefined) throw new Error(`cannot parse colour ${color}`);
  const [red, green, blue, alpha] = rgba.split(",").map((part) => Number.parseFloat(part.trim()));
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`cannot parse colour ${color}`);
  }
  return [red, green, blue, alpha ?? 1];
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(foreground: string, background: string): number {
  const [fr, fg, fb, alpha] = parse(foreground);
  const [br, bg, bb] = parse(background);
  // A translucent foreground is flattened over its ground before being measured.
  const front = luminance([
    fr * alpha + br * (1 - alpha),
    fg * alpha + bg * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  ]);
  const back = luminance([br, bg, bb]);
  const [high, low] = front > back ? [front, back] : [back, front];
  return (high + 0.05) / (low + 0.05);
}

function resolve(
  theme: Map<string, string>,
  base: Map<string, string>,
  token: string,
  seen = new Set<string>(),
): string {
  const value = theme.get(token) ?? base.get(token);
  if (value === undefined) throw new Error(`no token ${token}`);
  const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(value)?.[1];
  if (alias === undefined) return value;
  if (seen.has(token)) throw new Error(`token cycle at ${token}`);
  seen.add(token);
  return resolve(theme, base, alias, seen);
}

/** Every pair a reader has to make out. */
const TEXT_PAIRS: [string, string][] = [
  ["--text", "--background"],
  ["--text", "--surface"],
  ["--text", "--surface-strong"],
  ["--text", "--background-elevated"],
  ["--text", "--surface-sunken"],
  ["--text-muted", "--background"],
  ["--text-muted", "--surface"],
  ["--text-subtle", "--background"],
  ["--text-subtle", "--surface"],
  ["--accent", "--background"],
  ["--accent", "--surface"],
  ["--accent-contrast", "--accent-fill"],
  ["--code", "--surface"],
  ["--code", "--surface-sunken"],
  ["--success", "--success-surface"],
  ["--success", "--surface"],
  ["--warning", "--warning-surface"],
  ["--warning", "--surface"],
  ["--danger", "--danger-surface"],
  ["--danger", "--surface"],
  ["--info", "--info-surface"],
  ["--info", "--surface"],
  ["--skip-text", "--accent"],
  ["--foundry-ink", "--foundry-canvas-subdued"],
  ["--foundry-ink", "--foundry-surface-strong"],
  ["--foundry-copper", "--foundry-canvas"],
];

/** Non-text UI boundaries and secondary material accents. */
const NON_TEXT_PAIRS: [string, string][] = [
  ["--foundry-brass", "--foundry-canvas"],
  ["--foundry-copper-strong", "--foundry-surface"],
];

describe("palette contrast", () => {
  const dark = declarations(DARK);

  it("keeps every text pair at WCAG AA", () => {
    const failures = TEXT_PAIRS.map(([foreground, background]) => {
      const ratio = contrast(resolve(dark, dark, foreground), resolve(dark, dark, background));
      return ratio < 4.5 ? `${foreground} on ${background} is ${ratio.toFixed(2)}:1` : undefined;
    }).filter((failure) => failure !== undefined);

    expect(failures).toEqual([]);
  });

  it("keeps the focus ring visible against both grounds", () => {
    for (const ground of ["--background", "--surface"]) {
      expect(contrast(resolve(dark, dark, "--focus"), resolve(dark, dark, ground))).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps material boundaries visible", () => {
    for (const [foreground, background] of NON_TEXT_PAIRS) {
      expect(contrast(resolve(dark, dark, foreground), resolve(dark, dark, background))).toBeGreaterThanOrEqual(3);
    }
  });

  it("declares a colour scheme so form controls follow", () => {
    expect(stylesheet).toContain("color-scheme: dark");
  });
});
