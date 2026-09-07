/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { CommandPalette } from "../../../apps/web/components/ui/command-palette.js";

const runtime = globalThis as unknown as {
  document: Document;
  KeyboardEvent: typeof KeyboardEvent;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("CommandPalette", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
    container = runtime.document.createElement("div");
    runtime.document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(CommandPalette, {}));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
    await act(async () => {
      runtime.document.dispatchEvent(new runtime.KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
  }

  function dialog(): Element | null {
    return runtime.document.querySelector('[role="dialog"]');
  }

  /** React tracks the input's value, so a plain assignment is swallowed. */
  async function typeQuery(value: string): Promise<void> {
    const field = dialog()?.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("advertises the shortcut on the trigger rather than in decorative text", () => {
    const trigger = container.querySelector("[data-command-trigger]");
    expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Meta+K Control+K");
    expect(trigger?.getAttribute("aria-label")).toBe("Search");
  });

  it("renders no platform keycap on the server, so the markup never claims a Mac shortcut", () => {
    const markup = renderToStaticMarkup(createElement(CommandPalette, {}));
    expect(markup).not.toContain("⌘");
    expect(markup).not.toContain("command-hint");
  });

  it("opens on Ctrl+K and closes on Escape", async () => {
    expect(dialog()).toBeNull();
    await press("k", { ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    await press("Escape");
    expect(dialog()).toBeNull();
  });

  it("opens on a bare slash when the viewer is not already typing", async () => {
    await press("/");
    expect(dialog()).not.toBeNull();
  });

  it("ignores a slash typed into a text field", async () => {
    const input = runtime.document.createElement("input");
    runtime.document.body.append(input);
    input.focus();
    await act(async () => {
      input.dispatchEvent(new runtime.KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    input.remove();
  });

  it("filters destinations to the typed query and marks the first match active", async () => {
    await press("k", { metaKey: true });
    await typeQuery("polic");

    const options = Array.from(dialog()?.querySelectorAll("li > *") ?? []);
    expect(options).toHaveLength(1);
    expect(options[0]?.getAttribute("href")).toBe("/policies");
    expect(options[0]?.getAttribute("aria-current")).toBe("true");
  });

  it("says so when nothing matches instead of showing an empty list", async () => {
    await press("k", { ctrlKey: true });
    await typeQuery("zzzz");
    expect(dialog()?.textContent).toContain("No matches");
  });
});
