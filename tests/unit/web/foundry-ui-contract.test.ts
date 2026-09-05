import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = await readFile("apps/web/app/globals.css", "utf8");

describe("Technical Premium UI contract", () => {
  it("declares the approved graphite and electric blue tokens", () => {
    expect(css).toContain("--primary: #0969da;");
    expect(css).toContain("--primary: #58a6ff;");
    expect(css).not.toMatch(/linear-gradient\([^;]*(purple|#7c3aed|#8b5cf6)/i);
  });

  it("uses restrained geometry and sharp corners", () => {
    expect(css).toContain("--radius: 0.125rem;");
    expect(css).toContain("@custom-variant dark");
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
  });
});
