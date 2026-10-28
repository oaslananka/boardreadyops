/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewCanvas } from "../../../apps/web/components/review/review-canvas.js";

const runtime = globalThis as unknown as {
  document: Document;
  KeyboardEvent: typeof KeyboardEvent;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("source review canvas keyboard focus", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
    host = runtime.document.createElement("div");
    runtime.document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          createElement("input", { "aria-label": "Find repository" }),
          createElement(ReviewCanvas, { headSnapshots: [] }),
          createElement(ReviewCanvas, { headSnapshots: [] }),
        ),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  function canvases(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[aria-label="Schematic and PCB Review Canvas"]')];
  }

  function imageTransform(canvas: HTMLElement): string {
    return canvas.firstElementChild instanceof HTMLElement ? canvas.firstElementChild.style.transform : "";
  }

  async function press(element: HTMLElement, key: string): Promise<boolean> {
    const event = new runtime.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => {
      element.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  it("does not pan an unrelated board when the user types arrow keys in a search field", async () => {
    const [first, second] = canvases();
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Find repository"]');
    if (!first || !second || !search) throw new Error("missing test elements");
    search.focus();
    expect(await press(search, "ArrowRight")).toBe(false);
    expect(await press(search, "+")).toBe(false);
    expect(imageTransform(first)).toContain("translate(0px, 0px)");
    expect(imageTransform(second)).toContain("translate(0px, 0px)");
  });

  it("provides a tab-focusable canvas and pans only the focused board, preventing page scroll", async () => {
    const [first, second] = canvases();
    if (!first || !second) throw new Error("missing test canvas");
    expect(first.tabIndex).toBe(0);
    expect(first.className).toContain("focus-visible:outline-primary");
    expect(host.textContent).toContain("Focus the canvas to pan with arrow keys");
    first.focus();
    expect(await press(first, "ArrowRight")).toBe(true);
    expect(imageTransform(first)).toContain("translate(-20px, 0px)");
    expect(imageTransform(second)).toContain("translate(0px, 0px)");
    second.focus();
    expect(await press(second, "ArrowDown")).toBe(true);
    expect(imageTransform(second)).toContain("translate(0px, -20px)");
    expect(imageTransform(first)).toContain("translate(-20px, 0px)");
  });

  it("does not hijack keyboard controls on embedded canvas marker buttons", async () => {
    const first = canvases()[0];
    if (!first) throw new Error("missing test canvas");
    const button = runtime.document.createElement("button");
    first.append(button);
    button.focus();
    expect(await press(button, "ArrowRight")).toBe(false);
    expect(imageTransform(first)).toContain("translate(0px, 0px)");
  });
});
