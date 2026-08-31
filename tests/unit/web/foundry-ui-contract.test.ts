import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = await readFile("apps/web/app/styles.css", "utf8");

describe("Technical Premium UI contract", () => {
  it("declares the approved material, geometry, and typography tokens", () => {
    for (const token of [
      "--foundry-canvas",
      "--foundry-surface",
      "--foundry-ink",
      "--foundry-copper",
      "--foundry-brass",
      "--foundry-line",
      "--rail-width",
      "--rail-width-compact",
    ]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).toContain("--font-display: var(--font-ui-loaded, Inter)");
    expect(css).not.toMatch(/linear-gradient\([^;]*(purple|#7c3aed|#8b5cf6)/i);
  });

  it("uses restrained geometry and exposes accessibility states", () => {
    expect(css).toContain("--bro-radius-lg: 8px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  it("defines intentional surface roles without oversized SaaS geometry", () => {
    for (const selector of [".surface-raised", ".surface-inset", ".decision-band", ".metric-strip", ".page-intro"]) {
      expect(css).toContain(selector);
    }
    expect(css).not.toMatch(/border-radius:\s*(2[0-9]|[3-9][0-9])px/);
  });

  it("renders panel tone variants with stable accessibility semantics", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Panel } = await import("../../../apps/web/components/ui.js");
    const markup = renderToStaticMarkup(
      createElement(Panel, { title: "Gate Check", id: "gate", tone: "critical" }, "content"),
    );
    expect(markup).toContain("surface-critical");
    expect(markup).toContain('id="gate"');
    expect(markup).toContain('aria-labelledby="gate-heading"');
  });
});
