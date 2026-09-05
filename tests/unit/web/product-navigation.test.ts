/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { ProductNavigation } from "../../../apps/web/components/product-navigation.js";

describe("ProductNavigation task-sequence grouping", () => {
  it("groups by workflow step, not by category", () => {
    const markup = renderToStaticMarkup(createElement(ProductNavigation, {}));
    expect(markup).toContain("Get a board in");
    expect(markup).toContain("Work the findings");
    expect(markup).toContain("Ship it");
    expect(markup).not.toContain(">Overview<");
    expect(markup).not.toContain(">Engineering<");
    expect(markup).not.toContain(">Manage<");

    const projectsIndex = markup.indexOf("Projects");
    const getBoardInIndex = markup.indexOf("Get a board in");
    const workFindingsIndex = markup.indexOf("Work the findings");
    expect(getBoardInIndex).toBeLessThan(projectsIndex);
    expect(projectsIndex).toBeLessThan(workFindingsIndex);
  });

  it("still renders Dashboard as its own top-level link", () => {
    const markup = renderToStaticMarkup(createElement(ProductNavigation, {}));
    expect(markup).toContain('href="/dashboard"');
  });
});

describe("ProductNavigation preserved behavior: mobile drawer and focus management", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("exposes honest aria controls for the mobile drawer trigger", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    const trigger = container.querySelector('button[aria-controls="product-navigation-drawer"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-label")).toBe("Open navigation");
  });

  it("moves focus to the first link on open and back to the trigger on Escape close", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-controls="product-navigation-drawer"]');
    if (!trigger) throw new Error("mobile trigger not found");

    await act(async () => {
      trigger.click();
    });

    const dashboardLink = container.querySelector<HTMLAnchorElement>('a[href="/dashboard"]');
    expect(document.activeElement).toBe(dashboardLink);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    const triggerAfterClose = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="product-navigation-drawer"]',
    );
    expect(document.activeElement).toBe(triggerAfterClose);
    expect(triggerAfterClose?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ProductNavigation collapse persistence", () => {
  let container: HTMLDivElement;
  let root: Root;
  const storageKey = "boardreadyops.product-nav.compact";

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    window.localStorage.clear();
  });

  it("starts expanded (matching the server render) even if a prior session left it collapsed", async () => {
    window.localStorage.setItem(storageKey, "true");
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    expect(container.querySelector('[data-compact="true"]')).not.toBeNull();
  });

  it("persists the collapse choice across remounts", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse navigation"]');
    if (!toggle) throw new Error("compact toggle button not found");
    await act(async () => {
      toggle.click();
    });

    expect(window.localStorage.getItem(storageKey)).toBe("true");

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    expect(container.querySelector('[data-compact="true"]')).not.toBeNull();
  });
});
