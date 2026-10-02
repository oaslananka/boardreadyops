/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewerControls } from "../../../apps/web/components/viewer-controls.js";

type TestElement = {
  dispatchEvent(event: unknown): void;
};

type TestContainer = {
  querySelector(selector: string): TestElement | null;
  remove(): void;
};

type TestRuntime = {
  document: {
    body: {
      append(child: unknown): void;
      querySelector(selector: string): { textContent: string | null; getAttribute(name: string): string | null } | null;
    };
    createElement(tag: string): unknown;
  };
  KeyboardEvent: new (type: string, init?: { key?: string; bubbles?: boolean }) => unknown;
};

describe("ViewerControls", () => {
  let container: TestContainer;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("routes Workspace settings to the workspace access page", async () => {
    await act(async () => {
      root.render(createElement(ViewerControls, { login: "octocat" }));
    });

    const trigger = container.querySelector('button[aria-haspopup="menu"]');
    if (!trigger) throw new Error("account menu trigger not found");

    await act(async () => {
      trigger.dispatchEvent(new runtime.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    const link = runtime.document.body.querySelector('a[href="/settings/workspace"]');
    expect(link?.textContent).toContain("Workspace settings");
    expect(runtime.document.body.querySelector('a[href="/settings/billing"]')).toBeNull();
  });
});
