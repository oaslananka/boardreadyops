/**
 * @vitest-environment happy-dom
 */
import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewDesignWorkspace } from "../../../apps/web/components/review/review-design-workspace.js";
import { VerifiedObjectPositions } from "../../../apps/web/components/review/verified-object-positions.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const uuidA = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
const uuidB = "c71b2196-ae56-4853-92ac-5497683704cd";
const nativeAnchor = (uuid: string, x: number, y: number, changes: Partial<CanvasAnchor> = {}): CanvasAnchor => ({
  id: `drc-${uuid}`,
  kind: "finding",
  layer: "F.Cu",
  x: 0.4,
  y: 0.5,
  metadata: { sourceUuid: uuid, sourceXmm: x, sourceYmm: y, provenance: "kicad-json-object-position" },
  ...changes,
});
const nativeSnapshot = (anchors: CanvasAnchor[], options: Partial<SnapshotArtifact> = {}): SnapshotArtifact => ({
  id: "native",
  name: "kicad_native_board_F.Cu.svg",
  kind: "pcb_layer",
  format: "svg",
  sheetOrLayer: "board / F.Cu",
  width: 600,
  height: 400,
  sha256: "a".repeat(64),
  anchors,
  ...options,
});
const htmlFor = (baseSnapshots: SnapshotArtifact[], headSnapshots: SnapshotArtifact[]) =>
  renderToStaticMarkup(createElement(VerifiedObjectPositions, { baseSnapshots, headSnapshots }));

describe("source-verified PCB movement presentation", () => {
  it("shows the real moved UUID and physical base/head displacement, not canvas pixels", () => {
    const base = nativeSnapshot([nativeAnchor(uuidA, 1, 2), nativeAnchor(uuidB, 3, 4)]);
    const head = nativeSnapshot([nativeAnchor(uuidA, 1.25, 5, { x: 0.99, y: 0.02 }), nativeAnchor(uuidB, 3, 4)]);
    const html = htmlFor([base], [head]);
    expect(html).toContain('aria-label="Source-verified PCB object movement"');
    expect(html).toContain("1 moved · 1 unchanged (observed)");
    expect(html).toContain(uuidA);
    expect(html).toContain("1, 2");
    expect(html).toContain("1.25, 5");
    expect(html).toContain("0.25, 3");
    expect(html).not.toContain(uuidB);
    expect(html).toContain("not a complete PCB inventory");
  });

  it("distinguishes absent revision evidence from lack of observed moves", () => {
    const native = nativeSnapshot([nativeAnchor(uuidA, 1, 2)]);
    expect(htmlFor([], [native])).toContain("Position comparison unavailable");
    expect(htmlFor([], [native])).not.toContain("0 moved");
    expect(htmlFor([native], [native])).toContain("No movement observed among 1 matched source object(s)");
    expect(htmlFor([native], [native])).toContain("Unreferenced PCB objects were not assessed");
  });

  it("does not turn missing or untrusted DRC anchors into added/removed/moved objects", () => {
    const base = nativeSnapshot([nativeAnchor(uuidA, 1, 2)]);
    const different = nativeSnapshot([nativeAnchor(uuidB, 4, 5)]);
    const html = htmlFor([base], [different]);
    expect(html).toContain("No shared source-verified DRC objects could be compared");
    expect(html).toContain("do not establish that an object was");
    expect(html).not.toContain("0 moved");
    const fabricated = nativeSnapshot([
      nativeAnchor(uuidA, 5, 6, {
        metadata: { sourceUuid: uuidA, sourceXmm: 5, sourceYmm: 6, provenance: "summary-grid" },
      }),
    ]);
    expect(htmlFor([base], [fabricated])).toContain("No shared source-verified DRC objects");
  });

  it("opens a linked DRC finding only for a verified head UUID, position and recorded fingerprint", async () => {
    const base = nativeSnapshot([nativeAnchor(uuidA, 1, 2)]);
    const head = nativeSnapshot([
      nativeAnchor(uuidA, 3, 4, {
        metadata: {
          sourceUuid: uuidA,
          sourceXmm: 3,
          sourceYmm: 4,
          provenance: "kicad-json-object-position",
          fingerprint: "drc-confirmed",
        },
      }),
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const activated: string[] = [];
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const render = async (fingerprints: string[]) => {
        await act(async () =>
          root.render(
            createElement(VerifiedObjectPositions, {
              baseSnapshots: [base],
              headSnapshots: [head],
              findingFingerprints: fingerprints,
              onInspectFinding: (fingerprint: string) => activated.push(fingerprint),
            }),
          ),
        );
      };
      await render([]);
      expect(container.querySelector("button")).toBeNull();
      await render(["drc-confirmed"]);
      const button = container.querySelector("button");
      expect(button?.textContent).toContain("Inspect linked DRC finding");
      await act(async () => button?.click());
      expect(activated).toEqual(["drc-confirmed"]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("restores the inspector and selects the exact linked warning from a focused PCB canvas", async () => {
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("Missing fixture");
    const target = review.findings.find((f) => f.fingerprint === "fp_silk_pad_j3");
    if (!target) throw new Error("Missing nonblocking linked DRC warning");
    const base = nativeSnapshot([nativeAnchor(uuidA, 11, 20)]);
    const head = nativeSnapshot([
      nativeAnchor(uuidA, 12, 20, {
        metadata: {
          sourceUuid: uuidA,
          sourceXmm: 12,
          sourceYmm: 20,
          provenance: "kicad-json-object-position",
          fingerprint: target.fingerprint,
        },
      }),
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(
          createElement(ReviewDesignWorkspace, {
            review: { ...review, baseSnapshots: [base], headSnapshots: [head] },
          }),
        ),
      );
      const inspector = container.querySelector<HTMLElement>('aside[aria-label="Selected finding inspector"]');
      const focus = container.querySelector<HTMLButtonElement>('button[aria-controls="review-evidence-canvas"]');
      const linked = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Inspect linked DRC finding"),
      );
      expect(linked).toBeDefined();
      expect(inspector?.textContent).not.toContain(target.ruleId);
      await act(async () => focus?.click());
      expect(inspector?.classList.contains("hidden")).toBe(true);
      await act(async () => linked?.click());
      expect(inspector?.classList.contains("hidden")).toBe(false);
      expect(inspector?.textContent).toContain(target.ruleId);
      expect(inspector?.textContent).toContain(target.message);
      expect(
        container.querySelector('button[aria-controls="review-evidence-canvas"]')?.getAttribute("aria-pressed"),
      ).toBe("false");
      expect(container.textContent).toContain("All (");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("does not render source movement claims for generated summary imagery", () => {
    const summary = nativeSnapshot([nativeAnchor(uuidA, 1, 2)], { name: "pcb_summary_F.Cu.svg" });
    expect(htmlFor([summary], [summary])).toBe("");
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("Missing fixture");
    const workspace = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: { ...review, baseSnapshots: [summary], headSnapshots: [summary] },
      }),
    );
    expect(workspace).not.toContain("Source-verified object movement");
  });

  it("appears within Review for comparable native evidence without changing findings or verdict", () => {
    const review = DEMO_REVIEWS[0];
    if (!review) throw new Error("Missing fixture");
    const base = nativeSnapshot([nativeAnchor(uuidA, 145, 92)]);
    const head = nativeSnapshot([nativeAnchor(uuidA, 150, 92)]);
    const html = renderToStaticMarkup(
      createElement(ReviewDesignWorkspace, {
        review: { ...review, baseSnapshots: [base], headSnapshots: [head] },
      }),
    );
    expect(html).toContain("Source-verified object movement");
    expect(html).toContain("1 moved · 0 unchanged (observed)");
    expect(html).toContain("See the evidence, then decide");
    expect(html).toContain("not a complete PCB inventory");
    expect(html).toContain("Focus PCB / schematic");
  });
});
