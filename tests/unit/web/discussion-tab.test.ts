/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscussionTab } from "../../../apps/web/components/review/discussion-tab.js";
import type { DemoComment } from "../../../apps/web/lib/demo-data.js";

type TestElement = {
  click(): void;
  textContent: string | null;
  value?: string;
  dispatchEvent?(event: unknown): void;
  querySelector?(selector: string): TestElement | null;
  getAttribute?(name: string): string | null;
};

type TestContainer = {
  innerHTML: string;
  querySelector(selector: string): TestElement | null;
  querySelectorAll(selector: string): TestElement[];
  remove(): void;
  textContent: string | null;
};

type TestRuntime = {
  document: {
    body: { append(child: unknown): void };
    createElement(tag: string): unknown;
  };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
};

describe("DiscussionTab component (real persistence wiring)", () => {
  let container: TestContainer;
  let root: Root;

  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  const comments: DemoComment[] = [
    {
      id: "cmt_open_1",
      authorId: "engineer@company.com",
      authorType: "internal",
      content: "Please confirm creepage distance on U12.",
      status: "open",
      createdAt: new Date().toISOString(),
    },
  ];

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

  it("calls onToggleStatus with the target status instead of mutating local state", async () => {
    const onToggleStatus = vi.fn();
    await act(async () => {
      root.render(createElement(DiscussionTab, { comments, onToggleStatus }));
    });

    const resolveButton = container.querySelector("button.button-small");
    if (!resolveButton) throw new Error("Mark Resolved button not found");
    expect(resolveButton.textContent).toBe("Mark Resolved");

    await act(async () => {
      resolveButton.click();
    });

    expect(onToggleStatus).toHaveBeenCalledWith("cmt_open_1", "resolved");
    // No local mutation: without a parent re-render supplying an updated `comments`
    // prop, the button must still read "Mark Resolved", not flip on its own.
    expect(container.querySelector("button.button-small")?.textContent).toBe("Mark Resolved");
  });

  it("calls onToggleStatus with 'open' to reopen an already-resolved comment", async () => {
    const onToggleStatus = vi.fn();
    const [firstComment] = comments;
    if (!firstComment) throw new Error("expected at least one seed comment");
    const resolvedComments: DemoComment[] = [{ ...firstComment, status: "resolved" }];
    await act(async () => {
      root.render(createElement(DiscussionTab, { comments: resolvedComments, onToggleStatus }));
    });

    await act(async () => {
      container.querySelector("button.button-small")?.click();
    });

    expect(onToggleStatus).toHaveBeenCalledWith("cmt_open_1", "open");
  });

  it("has a programmatic label for the comment field and no editable author identity field", async () => {
    await act(async () => {
      root.render(createElement(DiscussionTab, { comments: [], viewerLogin: "reviewer@acme.corp" }));
    });

    const textarea = container.querySelector("textarea");
    const label = container.querySelector("label");
    expect(textarea?.getAttribute?.("id")).toBeTruthy();
    expect(label?.getAttribute?.("for")).toBe(textarea?.getAttribute?.("id"));
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).toContain("Commenting as reviewer@acme.corp");
  });

  it("calls onAddComment with the trimmed content string, not a fabricated comment object", async () => {
    const onAddComment = vi.fn();
    await act(async () => {
      root.render(createElement(DiscussionTab, { comments: [], onAddComment }));
    });

    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");
    const nativeSetter = Object.getOwnPropertyDescriptor(
      (globalThis as unknown as { HTMLTextAreaElement: { prototype: object } }).HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      nativeSetter?.call(textarea, "  Layer stackup looks correct.  ");
      textarea.dispatchEvent?.(new runtime.Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent?.(new runtime.Event("submit", { bubbles: true, cancelable: true } as never));
    });

    expect(onAddComment).toHaveBeenCalledWith("Layer stackup looks correct.");
  });
});
