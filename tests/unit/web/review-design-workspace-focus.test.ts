/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ReviewDesignWorkspace } from "../../../apps/web/components/review/review-design-workspace.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("source-grounded canvas focus", () => {
  it("reversibly expands the PCB/schematic workspace without dropping its evidence inspector", async () => {
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("Expected Review fixture");
    const inspectableReview = {
      ...review,
      headSnapshots: [
        {
          id: "test-board",
          name: "kicad_native_test_board",
          kind: "pcb_layer" as const,
          format: "svg" as const,
          sheetOrLayer: "F.Cu",
          width: 600,
          height: 400,
          content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"></svg>',
          sha256: "a".repeat(64),
          anchors: [],
        },
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewDesignWorkspace, { review: inspectableReview })));
      const control = container.querySelector<HTMLButtonElement>('button[aria-controls="review-evidence-canvas"]');
      const inspector = container.querySelector<HTMLElement>('aside[aria-label="Selected finding inspector"]');
      const canvas = container.querySelector<HTMLElement>('[aria-label="Schematic and PCB Review Canvas"]');
      expect(control?.getAttribute("aria-pressed")).toBe("false");
      expect(inspector?.classList.contains("hidden")).toBe(false);
      expect(canvas?.className).toContain("h-[19rem]");

      await act(async () => control?.click());
      expect(control?.getAttribute("aria-pressed")).toBe("true");
      expect(control?.textContent).toContain("Show findings and inspector");
      expect(inspector?.classList.contains("hidden")).toBe(true);
      expect(canvas?.className).toContain("h-[min(75dvh,56rem)]");

      await act(async () => control?.click());
      expect(control?.getAttribute("aria-pressed")).toBe("false");
      expect(inspector?.classList.contains("hidden")).toBe(false);
      expect(canvas?.className).toContain("h-[19rem]");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
