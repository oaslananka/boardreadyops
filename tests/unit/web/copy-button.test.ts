/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../../../apps/web/components/copy-button.js";

type TestButton = {
  click(): void;
  textContent: string | null;
};

type TestContainer = {
  innerHTML: string;
  querySelector(selector: string): TestButton | null;
  remove(): void;
  textContent: string | null;
};

type TestRuntime = {
  document: {
    body: { append(child: unknown): void };
    createElement(tag: string): unknown;
  };
  navigator: object;
};

describe("CopyButton component", () => {
  let container: TestContainer;
  let root: Root;

  const runtime = globalThis as unknown as TestRuntime & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  function button(): TestButton {
    const element = container.querySelector("button");
    if (!element) throw new Error("CopyButton did not render a button");
    return element;
  }

  async function renderCopyButton(): Promise<void> {
    await act(async () => {
      root.render(createElement(CopyButton, { label: "Copy SHA-256", value: "abc123" }));
    });
  }

  async function clickButton(): Promise<void> {
    await act(async () => {
      button().click();
      await Promise.resolve();
    });
  }

  it("shows copied feedback and resets it after two seconds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(runtime.navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderCopyButton();

    expect(button().textContent).toBe("Copy SHA-256");
    expect(container.innerHTML).toContain('aria-live="polite"');

    await clickButton();
    expect(writeText).toHaveBeenCalledWith("abc123");
    expect(button().textContent).toBe("Copied ✓");
    expect(container.textContent).toContain("Checksum copied.");

    await act(async () => vi.advanceTimersByTime(2_000));
    expect(button().textContent).toBe("Copy SHA-256");
  });

  it("shows failure feedback and resets it after the failure timeout", async () => {
    Object.defineProperty(runtime.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await renderCopyButton();

    await clickButton();
    expect(button().textContent).toBe("Copy failed");
    expect(container.textContent).toContain("Checksum could not be copied.");

    await act(async () => vi.advanceTimersByTime(2_500));
    expect(button().textContent).toBe("Copy SHA-256");
  });

  it("restarts the feedback timeout on rapid repeated copies and clears it on unmount", async () => {
    Object.defineProperty(runtime.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await renderCopyButton();

    await clickButton();
    await act(async () => vi.advanceTimersByTime(1_500));
    await clickButton();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTime(500));
    expect(button().textContent).toBe("Copied ✓");

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
  });
});
