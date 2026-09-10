import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = await readFile("apps/web/app/globals.css", "utf8");

function themeBlock(selector: ":root" | ".dark"): string {
  const pattern = selector === ":root" ? /:root\s*\{([^}]*)\}/su : /\.dark\s*\{([^}]*)\}/su;
  const match = css.match(pattern);
  if (!match?.[1]) throw new Error(`missing ${selector} block in globals.css`);
  return match[1];
}

describe("Graphite & Iris UI contract", () => {
  it("declares the approved graphite base and single iris accent", () => {
    expect(css).toContain("--primary: #4a3fd4;");
    expect(css).toContain("--primary: #9e93ff;");
    expect(css).not.toMatch(/linear-gradient\([^;]*(purple|#7c3aed|#8b5cf6)/i);
  });

  it("keeps the accent distinct from the interaction colour in both themes", () => {
    // ADR-0016 reserves one accent for interaction. `--accent` is the subtle hover surface and
    // `--info` is a status colour; if either aliases `--primary` those distinctions collapse.
    for (const selector of [":root", ".dark"] as const) {
      const block = themeBlock(selector);
      const read = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "u"))?.[1];
      expect(read("accent")).not.toBe(read("primary"));
      expect(read("info")).not.toBe(read("primary"));
    }
  });

  it("uses restrained geometry and sharp corners", () => {
    expect(css).toContain("--radius: 0.25rem;");
    expect(css).toContain("@custom-variant dark");
  });

  it("wires the loaded font faces into the Tailwind theme", () => {
    // Without these the next/font variables declared in app/layout.tsx are never reachable and
    // every `font-sans` / `font-mono` utility falls back to the default stack.
    const theme = css.match(/@theme inline\s*\{(.*?)\n\}/su)?.[1];
    expect(theme).toBeDefined();
    expect(theme).toContain("--font-sans: var(--font-ui-loaded)");
    expect(theme).toContain("--font-mono: var(--font-mono-loaded)");
    expect(theme).toContain("--font-display: var(--font-display-loaded)");
  });

  it("declares an elevation scale and a strong border in both themes", () => {
    for (const selector of [":root", ".dark"] as const) {
      const block = themeBlock(selector);
      expect(block).toContain("--elevation-1:");
      expect(block).toContain("--elevation-2:");
      expect(block).toContain("--elevation-3:");
      expect(block).toContain("--border-strong:");
    }
  });

  it("renders panel tone variants with stable accessibility semantics", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Panel } = await import("../../../apps/web/components/ui.js");
    const markup = renderToStaticMarkup(
      createElement(Panel, { title: "Gate Check", id: "gate", tone: "section" }, "content"),
    );
    expect(markup).toContain("border-dashed");
    expect(markup).toContain('id="gate"');
    expect(markup).toContain('aria-labelledby="gate-heading"');
    expect(markup).toContain('role="region"');
  });
});
