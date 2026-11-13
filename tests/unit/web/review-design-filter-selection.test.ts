/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewDesignWorkspace } from "../../../apps/web/components/review/review-design-workspace.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const fixture = DEMO_REVIEWS[0];
if (!fixture) throw new Error("Review fixture missing");
const blocker = fixture.findings.find((f) => f.severity === "error" && f.disposition === "open");
const warning = fixture.findings.find((f) => f.severity === "warning" && f.disposition !== "open");
if (!blocker || !warning) throw new Error("Review fixture must include blocking and nonblocking findings");
const review = {
  ...fixture,
  findings: [blocker, warning],
  headSnapshots: [
    {
      id: "linked-summary",
      name: "summary.svg",
      kind: "pcb_layer" as const,
      format: "svg" as const,
      sheetOrLayer: "F.Cu",
      width: 1000,
      height: 800,
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><rect width="1000" height="800"/></svg>',
      sha256: "a".repeat(64),
      anchors: [blocker, warning].map((finding, i) => ({
        id: `finding-${i}`,
        kind: "finding" as const,
        targetRef: finding.component,
        x: 0.25 + i * 0.5,
        y: 0.5,
        metadata: { fingerprint: finding.fingerprint, ruleId: finding.ruleId, severity: finding.severity },
      })),
    },
  ],
};

describe("Review finding filter and canvas selection", () => {
  it("opens the source-linked board and filters only uniquely verified KiCad object locations", async () => {
    const first = {
      ...blocker,
      fingerprint: "unmapped-blocker",
      ruleId: "drc.unmapped",
      message: "Unmapped DRC rule",
    };
    const located = {
      ...blocker,
      fingerprint: "verified-board-object",
      ruleId: "drc.hole_clearance",
      message: "Reported KiCad copper track",
    };
    const basis = review.headSnapshots[0];
    if (!basis) throw new Error("Review snapshot missing");
    const marker = {
      id: "reported-track",
      kind: "finding" as const,
      targetRef: "Track",
      x: 0.2,
      y: 0.6,
      layer: "B.Cu",
      metadata: {
        fingerprint: located.fingerprint,
        provenance: "kicad-json-object-position",
        sourceUuid: "5d98b95c-d01d-4e88-8c2c-83c62e48cb07",
        severity: "error",
        ruleId: located.ruleId,
        message: located.message,
      },
    };
    const schematic = {
      ...basis,
      id: "real-sheet",
      name: "kicad_native_schematic.svg",
      kind: "schematic" as const,
      sheetOrLayer: "Board / Connectors",
      anchors: [],
    };
    const front = {
      ...basis,
      id: "real-front",
      name: "kicad_native_board_F.Cu.svg",
      sheetOrLayer: "Board / F.Cu",
      anchors: [],
    };
    const back = {
      ...basis,
      id: "real-back",
      name: "kicad_native_board_B.Cu.svg",
      sheetOrLayer: "Board / B.Cu",
      anchors: [marker],
    };
    const sourceReview = {
      ...review,
      findings: [first, located],
      headSnapshots: [schematic, front, back],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewDesignWorkspace, { review: sourceReview })));
      const select = container.querySelector<HTMLSelectElement>("select#sheet-select");
      // The default source-linked finding sends the user directly to its real B.Cu layer.
      expect(select?.value).toBe("Board / B.Cu");
      const inspector = container.querySelector('aside[aria-label="Selected finding inspector"]');
      expect(inspector?.textContent).toContain(located.message);
      expect(container.textContent).toContain("On board (1)");
      const locatedButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "On board (1)",
      );
      await act(async () => locatedButton?.click());
      expect(locatedButton?.getAttribute("aria-pressed")).toBe("true");
      expect(container.textContent).toContain("1 of 2 findings shown");
      expect(container.textContent).not.toContain(first.message);

      const blockersButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Blockers (2)",
      );
      await act(async () => blockersButton?.click());
      expect(container.textContent).toContain("2 of 2 findings shown");
      expect(container.textContent).toContain(first.message);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }

    // A summary image or ambiguous/invalid source metadata cannot claim a physical position.
    const summary = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: { ...sourceReview, headSnapshots: [{ ...back, name: "summary.svg" }] },
      }),
    );
    expect(summary).not.toContain("On board (");
    const invalid = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: {
          ...sourceReview,
          headSnapshots: [
            { ...back, anchors: [{ ...marker, metadata: { ...marker.metadata, sourceUuid: "invalid" } }] },
          ],
        },
      }),
    );
    expect(invalid).not.toContain("On board (");
    const wrongLayer = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: { ...sourceReview, headSnapshots: [{ ...back, anchors: [{ ...marker, layer: "F.Cu" }] }] },
      }),
    );
    expect(wrongLayer).not.toContain("On board (");
    const outside = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: { ...sourceReview, headSnapshots: [{ ...back, anchors: [{ ...marker, x: 1.2 }] }] },
      }),
    );
    expect(outside).not.toContain("On board (");
    const duplicate = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: { ...sourceReview, findings: [located, { ...located }], headSnapshots: [back] },
      }),
    );
    expect(duplicate).not.toContain("On board (");
  });

  it("keeps a grouped native KiCad marker highlighted while cycling distinct findings", async () => {
    const secondary = {
      ...blocker,
      fingerprint: `${blocker.fingerprint}-same-object`,
      message: "Another violation on the same KiCad object",
    };
    const sourceUuid = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
    const anchors = [blocker, secondary].map((finding, index) => ({
      id: `sw2-${index}`,
      kind: "finding" as const,
      targetRef: "SW2",
      x: 0.4,
      y: 0.6,
      layer: "F.Cu",
      metadata: {
        fingerprint: finding.fingerprint,
        sourceUuid,
        provenance: "kicad-json-object-position",
        ruleId: finding.ruleId,
        message: finding.message,
        severity: finding.severity,
      },
    }));
    const sourceSnapshot = review.headSnapshots[0];
    if (!sourceSnapshot) throw new Error("Review source snapshot missing");
    const sourceReview = {
      ...review,
      findings: [blocker, secondary],
      headSnapshots: [
        {
          ...sourceSnapshot,
          name: "kicad_native_board.svg",
          anchors,
        },
      ],
    };
    const previousWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const previousHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const previousResizeObserver = globalThis.ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 420 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 320 });
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewDesignWorkspace, { review: sourceReview })));
      const marker = container.querySelector('button[aria-label*="source findings; click to cycle"]');
      expect(marker).not.toBeNull();
      expect(marker?.className).toContain("ring-2 ring-primary");
      await act(async () => (marker as HTMLButtonElement).click());
      expect(container.querySelector('aside[aria-label="Selected finding inspector"]')?.textContent).toContain(
        secondary.message,
      );
      expect(marker?.className).toContain("ring-2 ring-primary");
      await act(async () => (marker as HTMLButtonElement).click());
      expect(container.querySelector('aside[aria-label="Selected finding inspector"]')?.textContent).toContain(
        blocker.message,
      );
      expect(marker?.className).toContain("ring-2 ring-primary");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      if (previousWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", previousWidth);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
      if (previousHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", previousHeight);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
      globalThis.ResizeObserver = previousResizeObserver;
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("reveals a selected canvas finding nested in a collapsed finding group", async () => {
    const repeats = [
      blocker,
      { ...blocker, fingerprint: `${blocker.fingerprint}-second`, message: "Second repeated blocker" },
      { ...blocker, fingerprint: `${blocker.fingerprint}-third`, message: "Third repeated blocker" },
    ];
    const repeatedReview = {
      ...review,
      findings: repeats,
      headSnapshots: review.headSnapshots.map((snapshot) => ({
        ...snapshot,
        anchors: repeats.map((finding, index) => ({
          id: `repeated-${index}`,
          kind: "finding" as const,
          targetRef: finding.component,
          x: 0.2 + index * 0.3,
          y: 0.5,
          metadata: {
            fingerprint: finding.fingerprint,
            ruleId: finding.ruleId,
            severity: finding.severity,
            message: finding.message,
          },
        })),
      })),
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewDesignWorkspace, { review: repeatedReview })));
      const group = container.querySelector("details");
      expect(group).not.toBeNull();
      expect(group?.open).toBe(false);
      const thirdMarker = [...container.querySelectorAll('button[title^="Finding:"]')].find((node) =>
        node.getAttribute("title")?.includes("Third repeated blocker"),
      );
      expect(thirdMarker).toBeDefined();
      await act(async () => thirdMarker?.click());
      const inspector = container.querySelector('aside[aria-label="Selected finding inspector"]');
      expect(inspector?.textContent).toContain("Third repeated blocker");
      const thirdRow = [...container.querySelectorAll("button[aria-pressed]")].find((node) =>
        node.textContent?.includes("Third repeated blocker"),
      );
      expect(thirdRow?.getAttribute("aria-pressed")).toBe("true");
      expect(group?.open).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("highlights only the visible inspected finding when a filter hides the previously selected marker", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
    const row = (fingerprint: string) =>
      [...container.querySelectorAll("button[aria-pressed]")].find((node) =>
        node.textContent?.includes(fingerprint === blocker.fingerprint ? blocker.message : warning.message),
      );
    const marker = (ruleId: string) =>
      [...container.querySelectorAll('button[title^="Finding:"]')].find((node) =>
        node.getAttribute("title")?.includes(ruleId),
      );
    const inspector = () =>
      container.querySelector('aside[aria-label="Selected finding inspector"]')?.textContent ?? "";
    try {
      await act(async () => root.render(createElement(ReviewDesignWorkspace, { review })));
      await act(async () => button("All (2)")?.click());
      await act(async () => row(warning.fingerprint)?.click());
      expect(inspector()).toContain(warning.ruleId);
      expect(row(warning.fingerprint)?.getAttribute("aria-pressed")).toBe("true");

      await act(async () => button("Blockers (1)")?.click());
      expect(inspector()).toContain(blocker.ruleId);
      expect(row(blocker.fingerprint)?.getAttribute("aria-pressed")).toBe("true");
      expect(marker(blocker.ruleId)?.className).toContain("ring-2 ring-primary");
      expect(marker(warning.ruleId)?.className).not.toContain("ring-2 ring-primary");

      // Selecting a real source marker hidden by the blocker filter must reveal it
      // in the list and return the inspector and canvas to the same fingerprint.
      await act(async () => marker(warning.ruleId)?.click());
      expect(button("All (2)")?.getAttribute("aria-pressed")).toBe("true");
      expect(inspector()).toContain(warning.ruleId);
      expect(row(warning.fingerprint)?.getAttribute("aria-pressed")).toBe("true");
      expect(marker(warning.ruleId)?.className).toContain("ring-2 ring-primary");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
