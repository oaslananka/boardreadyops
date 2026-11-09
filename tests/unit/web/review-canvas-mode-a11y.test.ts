/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ReviewCanvas } from "../../../apps/web/components/review/review-canvas.js";

const head = {
  id: "head",
  name: "board.svg",
  kind: "pcb_layer" as const,
  format: "svg" as const,
  sheetOrLayer: "board / F.Cu",
  width: 25.4,
  height: 25.4,
  content: '<svg viewBox="0 0 25.4 25.4"></svg>',
  sha256: "a".repeat(64),
  anchors: [],
};
const base = { ...head, id: "base", sha256: "b".repeat(64) };

describe("revision comparison mode accessibility", () => {
  it("exposes a single selected mode and updates it on interaction", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => {
        root.render(
          createElement(ReviewCanvas, { headSnapshots: [head], baseSnapshots: [base], findings: [], comments: [] }),
        );
      });
      const group = container.querySelector('fieldset[aria-label="Revision comparison modes"]');
      expect(group).not.toBeNull();

      const mode = (name: string) =>
        [...(group?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.trim() === name);
      const selected = () => [...(group?.querySelectorAll('button[aria-pressed="true"]') ?? [])];

      expect(mode("Head Only")?.getAttribute("aria-pressed")).toBe("true");
      expect(selected()).toHaveLength(1);
      expect(mode("Visual Diff")?.getAttribute("aria-pressed")).toBe("false");

      await act(async () => {
        mode("Visual Diff")?.click();
      });
      expect(mode("Visual Diff")?.getAttribute("aria-pressed")).toBe("true");
      expect(mode("Head Only")?.getAttribute("aria-pressed")).toBe("false");
      expect(selected()).toHaveLength(1);
      const diffNotice = [...container.querySelectorAll('[role="status"]')].find((el) =>
        el.textContent?.includes("Visual Diff shows color differences"),
      );
      expect(diffNotice?.textContent).toContain("Black areas have no visible pixel-color");
      expect(diffNotice?.textContent).toContain("An all-black view is not proof of electrical");
      expect(diffNotice?.textContent).toContain("Use Split to inspect both source images");

      await act(async () => {
        mode("Base Only")?.click();
      });
      expect(mode("Base Only")?.getAttribute("aria-pressed")).toBe("true");
      expect(mode("Visual Diff")?.getAttribute("aria-pressed")).toBe("false");
      expect(selected()).toHaveLength(1);
      expect(container.textContent).not.toContain("Visual Diff shows color differences");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("keeps every revision mode discoverable without horizontal scrolling on narrow screens", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => {
        root.render(createElement(ReviewCanvas, { headSnapshots: [head], baseSnapshots: [base] }));
      });
      const group = container.querySelector<HTMLElement>('fieldset[aria-label="Revision comparison modes"]');
      expect(group).not.toBeNull();
      expect(group?.className).toContain("grid-cols-2");
      expect(group?.className).toContain("sm:flex");
      expect(group?.className).not.toContain("overflow-x-auto");
      expect([...(group?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim())).toEqual([
        "Overlay",
        "Split",
        "Visual Diff",
        "Head Only",
        "Base Only",
      ]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("keeps the only available head view selected when comparison is unavailable", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => {
        root.render(createElement(ReviewCanvas, { headSnapshots: [head], findings: [], comments: [] }));
      });
      const group = container.querySelector('fieldset[aria-label="Revision comparison modes"]');
      expect(group?.querySelector('button[aria-pressed="true"]')?.textContent?.trim()).toBe("Head Only");
      expect(group?.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});

describe("revision artwork absent from one side", () => {
  it("shows published base-only layer evidence instead of a blank head canvas, without claiming deletion", async () => {
    const oldLayer = {
      ...base,
      id: "base-only-layer",
      name: "base-Inner1.Cu.svg",
      sheetOrLayer: "board / In1.Cu",
      content: '<svg viewBox="0 0 25.4 25.4"><path id="older-copper" /></svg>',
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(createElement(ReviewCanvas, { headSnapshots: [head], baseSnapshots: [base, oldLayer] })),
      );
      const select = container.querySelector<HTMLSelectElement>("#sheet-select");
      if (!select) throw new Error("layer selector unavailable");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(select, "board / In1.Cu");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const controls = container.querySelector('fieldset[aria-label="Revision comparison modes"]');
      const modes = [...(controls?.querySelectorAll("button") ?? [])];
      const mode = (label: string) => modes.find((button) => button.textContent?.trim() === label);
      expect(mode("Base Only")?.getAttribute("aria-pressed")).toBe("true");
      expect(mode("Head Only")?.disabled).toBe(true);
      expect(mode("Overlay")?.disabled).toBe(true);
      expect(mode("Split")?.disabled).toBe(true);
      expect(mode("Visual Diff")?.disabled).toBe(true);
      expect(controls?.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
      expect(container.querySelector('img[alt="Base Revision Snapshot Layer"]')?.getAttribute("src")).toContain(
        "older-copper",
      );
      expect(container.querySelector('img[alt="Head Revision Snapshot Layer"]')).toBeNull();
      expect(container.textContent).toContain("No head snapshot was published for board / In1.Cu");
      expect(container.textContent).toContain("does not establish that the layer was removed");

      await act(async () => {
        setter?.call(select, "board / F.Cu");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(mode("Head Only")?.disabled).toBe(false);
      expect(mode("Head Only")?.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector('img[alt="Head Revision Snapshot Layer"]')).not.toBeNull();
      expect(container.textContent).not.toContain("No head snapshot was published");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("starts on the actual base-only layer if no head artwork was published", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewCanvas, { headSnapshots: [], baseSnapshots: [base] })));
      expect(container.querySelector<HTMLSelectElement>("#sheet-select")?.value).toBe("board / F.Cu");
      expect(container.querySelector('button[aria-pressed="true"]')?.textContent?.trim()).toBe("Base Only");
      expect(container.querySelector('img[alt="Base Revision Snapshot Layer"]')).not.toBeNull();
      expect(container.textContent).toContain("No head snapshot was published");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("does not claim a visual diff when a head layer lacks matching base artwork", async () => {
    const otherLayer = { ...base, id: "base-other", sheetOrLayer: "board / B.Cu" };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(createElement(ReviewCanvas, { headSnapshots: [head], baseSnapshots: [otherLayer] })),
      );
      expect(container.querySelector('img[alt="Head Revision Snapshot Layer"]')).not.toBeNull();
      expect(container.textContent).toContain("No matching base snapshot was published for board / F.Cu");
      expect(container.textContent).toContain("visual comparison is unavailable for this layer");
      const controls = container.querySelector('fieldset[aria-label="Revision comparison modes"]');
      expect(
        [...(controls?.querySelectorAll("button") ?? [])].find((el) => el.title === "Difference highlight")?.disabled,
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
