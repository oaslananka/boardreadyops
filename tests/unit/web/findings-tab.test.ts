/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingsTab } from "../../../apps/web/components/review/findings-tab.js";
import type { DemoFinding } from "../../../apps/web/lib/demo-data.js";

type TestElement = {
  click(): void;
  focus?(): void;
  textContent: string | null;
  value?: string;
  getAttribute?(name: string): string | null;
  dispatchEvent?(event: unknown): void;
};

type TestContainer = {
  innerHTML: string;
  querySelector(selector: string): TestElement | null;
  querySelectorAll(selector: string): TestElement[];
  remove(): void;
};

type TestRuntime = {
  document: {
    body: { append(child: unknown): void };
    createElement(tag: string): unknown;
  };
};

describe("FindingsTab component (no local optimistic drift, accessible controls)", () => {
  let container: TestContainer;
  let root: Root;

  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  const findings: DemoFinding[] = [
    {
      fingerprint: "fp_1",
      ruleId: "clearance.min-trace-width",
      severity: "error",
      path: "board/top.kicad_pcb",
      message: "Trace width below fabrication minimum.",
      diffState: "new",
      disposition: "open",
      assignees: [],
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

  it("calls onUpdateDisposition without mutating local state when the parent leaves the finding prop unchanged", async () => {
    const onUpdateDisposition = vi.fn();
    await act(async () => {
      root.render(createElement(FindingsTab, { findings, onUpdateDisposition }));
    });

    const select = container.querySelector("select.disposition-select");
    if (!select) throw new Error("disposition select not found");
    expect(select.value).toBe("open");

    const nativeSetter = Object.getOwnPropertyDescriptor(
      (globalThis as unknown as { HTMLSelectElement: { prototype: object } }).HTMLSelectElement.prototype,
      "value",
    )?.set;
    const EventCtor = (globalThis as unknown as { Event: new (type: string, init?: { bubbles?: boolean }) => unknown })
      .Event;
    await act(async () => {
      nativeSetter?.call(select, "fixed");
      select.dispatchEvent?.(new EventCtor("change", { bubbles: true }));
    });

    expect(onUpdateDisposition).toHaveBeenCalledWith("fp_1", "fixed");
    // Simulating a failed API call: the parent does not pass a new `findings` array,
    // so the select must still reflect the original server-confirmed disposition,
    // not an optimistic local guess that never gets rolled back.
    expect(container.querySelector("select.disposition-select")?.value).toBe("open");
  });

  it("reflects a parent-confirmed disposition update once the findings prop changes", async () => {
    const onUpdateDisposition = vi.fn();
    await act(async () => {
      root.render(createElement(FindingsTab, { findings, onUpdateDisposition }));
    });

    const updatedFindings: DemoFinding[] = [{ ...findings[0], disposition: "fixed" } as DemoFinding];
    await act(async () => {
      root.render(createElement(FindingsTab, { findings: updatedFindings, onUpdateDisposition }));
    });

    expect(container.querySelector("select.disposition-select")?.value).toBe("fixed");
  });

  it("labels the search input, severity filter, disposition select, and assignee input", async () => {
    await act(async () => {
      root.render(createElement(FindingsTab, { findings }));
    });

    expect(container.querySelector('input[type="search"]')?.getAttribute?.("aria-label")).toBe("Search findings");
    expect(container.querySelector("select.triage-severity-select")?.getAttribute?.("aria-label")).toBe(
      "Filter by severity",
    );
    expect(container.querySelector("select.disposition-select")?.getAttribute?.("aria-label")).toBe(
      "Disposition for finding clearance.min-trace-width",
    );
    expect(container.querySelector("input.assignee-input")?.getAttribute?.("aria-label")).toBe(
      "Add assignee for finding clearance.min-trace-width",
    );
  });

  it("gives the diff-state filter buttons tab semantics with roving tabindex", async () => {
    await act(async () => {
      root.render(createElement(FindingsTab, { findings }));
    });

    const allTab = container.querySelector("#diff-state-tab-all");
    const newTab = container.querySelector("#diff-state-tab-new");
    expect(allTab?.getAttribute?.("role")).toBe("tab");
    expect(allTab?.getAttribute?.("aria-selected")).toBe("true");
    expect(allTab?.getAttribute?.("tabindex")).toBe("0");
    expect(newTab?.getAttribute?.("aria-selected")).toBe("false");
    expect(newTab?.getAttribute?.("tabindex")).toBe("-1");
  });
});
