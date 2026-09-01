import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductNavigation } from "../../../apps/web/components/product-navigation.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/reviews" }));

describe("ProductNavigation", () => {
  it("groups work, governance, and administration destinations", () => {
    const markup = renderToStaticMarkup(createElement(ProductNavigation));

    expect(markup).toContain('aria-label="Product navigation"');
    expect(markup).toContain("Workspace");
    expect(markup).toContain("My Work");
    expect(markup).toContain("Reviews");
    expect(markup).toContain("Dashboard");
    expect(markup).toContain("Governance");
    expect(markup).toContain("Administration");
    expect(markup).toContain("Settings");
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain(">Billing<");
  });

  it("exposes honest controls for the mobile drawer and compact rail", async () => {
    const { ProductNavigation } = await import("../../../apps/web/components/product-navigation.js");
    const markup = renderToStaticMarkup(createElement(ProductNavigation));

    expect(markup).toContain('aria-controls="product-navigation-drawer"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Open navigation");
    expect(markup).toContain("Collapse navigation");
  });
});
