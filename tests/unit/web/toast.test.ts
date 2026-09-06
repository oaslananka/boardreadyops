/**
 * @vitest-environment happy-dom
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "../../../apps/web/components/ui/toast.js";

const runtime = globalThis as unknown as { document: Document; IS_REACT_ACT_ENVIRONMENT?: boolean };

function Emitter({ run }: Readonly<{ run: (api: ReturnType<typeof useToast>) => void }>) {
  const toast = useToast();
  useEffect(() => run(toast), [run, toast]);
  return null;
}

describe("ToastProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
    container = runtime.document.createElement("div");
    runtime.document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  async function emit(run: (api: ReturnType<typeof useToast>) => void): Promise<void> {
    await act(async () => {
      root.render(createElement(ToastProvider, null, createElement(Emitter, { run })));
    });
  }

  it("adds nothing to the server markup beyond an empty viewport", () => {
    const markup = renderToStaticMarkup(createElement(ToastProvider, null, createElement("main", null, "page")));
    expect(markup).toContain("page");
    expect(markup).not.toContain("⌘");
    expect(markup).not.toContain("command-hint");
  });

  it("renders a success toast with its title and description", async () => {
    await emit((toast) => toast.success("Token created", "Copy it now."));
    const text = runtime.document.body.textContent ?? "";
    expect(text).toContain("Token created");
    expect(text).toContain("Copy it now.");
  });

  it("keeps an error toast on screen indefinitely so the reason can be read", async () => {
    await emit((toast) => toast.error("Checkout failed"));
    // Radix reads duration off the item; Infinity is how it is told never to auto-dismiss.
    const item = runtime.document.querySelector('[data-slot="toast"]');
    expect(item).not.toBeNull();
    expect(runtime.document.body.textContent).toContain("Checkout failed");
  });

  it("offers an explicit dismiss control on every toast", async () => {
    await emit((toast) => toast.toast({ title: "Heads up" }));
    const close = runtime.document.querySelector('[aria-label="Dismiss notification"]');
    expect(close).not.toBeNull();
  });

  it("throws when a consumer is mounted outside the provider, rather than dropping feedback", () => {
    expect(() => renderToStaticMarkup(createElement(Emitter, { run: () => undefined }))).toThrow(
      /useToast must be used inside/u,
    );
  });
});
