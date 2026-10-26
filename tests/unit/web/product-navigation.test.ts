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

  it("keeps advanced governance discoverable without exposing all links by default", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });
    const disclosure = container.querySelector<HTMLButtonElement>('button[aria-controls="nav-govern-items"]');
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#nav-govern-items")?.getAttribute("hidden")).not.toBeNull();
    await act(async () => disclosure?.click());
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#nav-govern-items")?.getAttribute("hidden")).toBeNull();
    expect(container.querySelector('#nav-govern-items a[href="/rules"]')).not.toBeNull();
    await act(async () => disclosure?.click());
    expect(container.querySelector("#nav-govern-items")?.getAttribute("hidden")).not.toBeNull();
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

  it("hides off-screen navigation from keyboard and assistive technology on mobile", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    const closedDrawer = container.querySelector("#product-navigation-drawer");
    expect(closedDrawer?.classList.contains("invisible")).toBe(true);
    expect(closedDrawer?.getAttribute("role")).toBeNull();
    expect(closedDrawer?.getAttribute("aria-modal")).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-controls="product-navigation-drawer"]');
    await act(async () => trigger?.click());
    expect(closedDrawer?.classList.contains("invisible")).toBe(false);
    expect(closedDrawer?.getAttribute("role")).toBe("dialog");
    expect(closedDrawer?.getAttribute("aria-modal")).toBe("true");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closedDrawer?.classList.contains("invisible")).toBe(true);
  });

  it("contains forward and backward keyboard focus within the open mobile drawer", async () => {
    await act(async () => {
      root.render(createElement(ProductNavigation, {}));
    });

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-controls="product-navigation-drawer"]');
    await act(async () => trigger?.click());

    const drawer = container.querySelector("#product-navigation-drawer");
    const controls = drawer?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const first = controls?.item(0);
    const last = controls?.item((controls?.length ?? 0) - 1);
    if (!first || !last) throw new Error("drawer controls missing");

    expect(document.activeElement).toBe(container.querySelector('a[href="/dashboard"]'));
    first.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(last);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);

    trigger?.focus(); // Simulate focus being programmatically moved outside the open drawer.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
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
