import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = await readFile("apps/web/app/styles.css", "utf8");

describe("Foundry Editorial UI contract", () => {
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
    expect(css).toContain("--font-display: var(--font-display-loaded");
    expect(css).not.toMatch(/linear-gradient\([^;]*(purple|#7c3aed|#8b5cf6)/i);
  });

  it("uses restrained geometry and exposes accessibility states", () => {
    expect(css).toContain("--bro-radius-lg: 12px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });
});
