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

      await act(async () => {
        mode("Base Only")?.click();
      });
      expect(mode("Base Only")?.getAttribute("aria-pressed")).toBe("true");
      expect(mode("Visual Diff")?.getAttribute("aria-pressed")).toBe("false");
      expect(selected()).toHaveLength(1);
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
