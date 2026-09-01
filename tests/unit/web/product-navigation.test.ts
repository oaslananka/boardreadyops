/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ProductNavigation collapse persistence", () => {
  type TestElement = {
    click(): void;
    getAttribute(name: string): string | null;
  };
  type TestContainer = {
    querySelector(selector: string): TestElement | null;
    remove(): void;
  };
  type TestRuntime = {
    document: { body: { append(child: unknown): void }; createElement(tag: string): unknown };
    localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void; clear(): void };
  };

  let container: TestContainer;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const storageKey = "boardreadyops.product-nav.compact";

  beforeEach(() => {
    runtime.localStorage.clear();
    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
    runtime.localStorage.clear();
  });

  it("starts expanded (matching the server render) even if a prior session left it collapsed", async () => {
    runtime.localStorage.setItem(storageKey, "true");
    await act(async () => {
      root.render(createElement(ProductNavigation));
    });

    expect(container.querySelector('[data-compact="true"]')).not.toBeNull();
  });

  it("persists the collapse choice across remounts", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation));
    });

    const toggle = container.querySelector(".product-compact-toggle");
    if (!toggle) throw new Error("compact toggle button not found");
    await act(async () => {
      toggle.click();
    });

    expect(runtime.localStorage.getItem(storageKey)).toBe("true");

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root.render(createElement(ProductNavigation));
    });

    expect(container.querySelector('[data-compact="true"]')).not.toBeNull();
  });
});
