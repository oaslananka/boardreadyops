/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../../apps/web/components/dialog.js";

type TestElement = {
  click(): void;
  focus(): void;
  textContent: string | null;
  dispatchEvent(event: unknown): void;
};

type TestContainer = {
  querySelector(selector: string): TestElement | null;
  querySelectorAll(selector: string): TestElement[];
  remove(): void;
};

type TestDocument = {
  body: { append(child: unknown): void };
  createElement(tag: string): unknown;
  activeElement: TestElement | null;
};

type TestRuntime = {
  document: TestDocument;
  KeyboardEvent: new (type: string, init?: { key?: string; bubbles?: boolean; shiftKey?: boolean }) => unknown;
};

describe("Dialog primitive (focus management)", () => {
  let container: TestContainer;
  let opener: TestElement;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    opener = runtime.document.createElement("button") as TestElement;
    runtime.document.body.append(opener);
    opener.focus();

    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (opener as unknown as { remove(): void }).remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  function renderDialog(onClose: () => void) {
    return act(async () => {
      root.render(
        createElement(
          Dialog,
          { titleId: "test-dialog-title", onClose },
          createElement("h2", { id: "test-dialog-title" }, "Test Dialog"),
          createElement("button", { type: "button" }, "First"),
          createElement("button", { type: "button" }, "Second"),
        ),
      );
    });
  }

  it("moves focus into the dialog on mount instead of leaving it on the body", async () => {
    await renderDialog(vi.fn());
    expect(runtime.document.activeElement?.textContent).toBe("First");
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    await renderDialog(onClose);

    await act(async () => {
      container
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new runtime.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab: wraps from the last focusable element back to the first", async () => {
    await renderDialog(vi.fn());
    const buttons = container.querySelectorAll("button");
    const last = buttons[buttons.length - 1];
    if (!last) throw new Error("expected at least one button");
    last.focus();

    await act(async () => {
      container
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new runtime.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });

    expect(runtime.document.activeElement?.textContent).toBe("First");
  });

  it("traps Shift+Tab: wraps from the first focusable element back to the last", async () => {
    await renderDialog(vi.fn());
    const first = container.querySelector("button");
    first?.focus();

    await act(async () => {
      container
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new runtime.KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    });

    expect(runtime.document.activeElement?.textContent).toBe("Second");
  });

  it("restores focus to the previously focused element when it unmounts", async () => {
    await renderDialog(vi.fn());
    expect(runtime.document.activeElement?.textContent).toBe("First");

    await act(async () => {
      root.unmount();
    });

    expect(runtime.document.activeElement).toBe(opener);
  });
});
