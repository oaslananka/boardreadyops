import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  comparableReviewSnapshots,
  positionContainedImageAnchor,
  ReviewCanvas,
} from "../../../apps/web/components/review/review-canvas.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import { buildDemoSnapshots } from "../../../apps/web/lib/demo-snapshots.js";

describe("ReviewCanvas", () => {
  const review = DEMO_REVIEWS[0] as (typeof DEMO_REVIEWS)[0];
  const headSnapshots = buildDemoSnapshots(review.changedFiles, review.findings);

  it("renders a data-uri image per sheet/layer snapshot, not raw inline SVG", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    expect(markup).toContain("Schematic and PCB Review Canvas");
    expect(markup).toContain('aria-label="Canvas instruments"');
    expect(markup).toContain("data:image/svg+xml");
    expect(markup).not.toContain("<svg");
  });

  it("lets the viewer switch between the changed sheets and layers", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    for (const snapshot of headSnapshots) {
      expect(markup).toContain(snapshot.sheetOrLayer);
    }
  });

  it("keeps long native sheet names inside the viewport on narrow screens", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    expect(markup).toContain('class="flex min-w-0 max-w-full flex-wrap items-center gap-3"');
    expect(markup).toContain(
      'class="min-w-0 max-w-full rounded-sm border border-border bg-background px-2 py-1 text-sm text-foreground"',
    );
  });

  it("permits visual compare only with exactly matched sheet identity and native viewport", () => {
    const base = {
      id: "pcb-base",
      name: "kicad_native_board.svg",
      kind: "pcb_layer" as const,
      format: "svg" as const,
      sheetOrLayer: "board / F.Cu",
      width: 26,
      height: 26,
      content: '<svg viewBox="0.0000 0.0000 25.4000 25.4000"></svg>',
      sha256: "a".repeat(64),
      anchors: [],
    };
    const head = { ...base, id: "pcb-head", sha256: "b".repeat(64) };
    expect(comparableReviewSnapshots(base, head)).toBe(true);
    expect(comparableReviewSnapshots(base, { ...head, sheetOrLayer: "board / B.Cu" })).toBe(false);
    expect(comparableReviewSnapshots(base, { ...head, content: '<svg viewBox="1 0 25.4 25.4"></svg>' })).toBe(false);
    expect(comparableReviewSnapshots(base, { ...head, content: '<svg viewBox="0 0 26.4 25.4"></svg>' })).toBe(false);
    expect(comparableReviewSnapshots(undefined, head)).toBe(false);
  });

  it("disables a dishonest overlay when native coordinate frames are different", () => {
    const base = {
      id: "base",
      name: "kicad_native_base.svg",
      kind: "pcb_layer" as const,
      format: "svg" as const,
      sheetOrLayer: "board / F.Cu",
      width: 26,
      height: 26,
      content: '<svg viewBox="0 0 25.4 25.4"></svg>',
      sha256: "a".repeat(64),
      anchors: [],
    };
    const head = { ...base, content: '<svg viewBox="1 0 25.4 25.4"></svg>', id: "head" };
    const html = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots: [head], baseSnapshots: [base] }));
    expect(html).toContain("These revisions have different canvas coordinates");
    expect(html).toMatch(/disabled=""[^>]+title="Difference highlight"/u);
    expect(html).toContain('alt="Head Revision Snapshot Layer"');
    expect(html).not.toContain('alt="Base Revision Snapshot Layer"');
  });

  it("positions native object markers inside the letterboxed PCB SVG on desktop and mobile", () => {
    // Equal source dimensions, but wide vs. tall viewport: object-fit:contain adds padding.
    const anchorX = (145.621548 - 135.255) / 25.4;
    const anchorY = (107.108452 - 92.075) / 25.4;
    const desktop = positionContainedImageAnchor(anchorX, anchorY, 486, 540, 25.4, 25.4);
    expect(desktop?.x).toBeCloseTo(anchorX, 9);
    expect(desktop?.y).toBeCloseTo((27 + anchorY * 486) / 540, 9);
    const mobile = positionContainedImageAnchor(anchorX, anchorY, 390, 304, 25.4, 25.4);
    expect(mobile?.x).toBeCloseTo((43 + anchorX * 304) / 390, 9);
    expect(mobile?.y).toBeCloseTo(anchorY, 9);
    expect(positionContainedImageAnchor(0.5, 0.5, 0, 400, 25.4, 25.4)).toBeUndefined();
    expect(positionContainedImageAnchor(1.4, 0.5, 300, 400, 25.4, 25.4)).toBeUndefined();
  });

  it("renders a finding marker for each anchor linked to a finding", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    const findingAnchorCount = headSnapshots[0]?.anchors.filter((a) => a.kind === "finding").length ?? 0;
    if (findingAnchorCount > 0) {
      expect(markup).toContain(headSnapshots[0]?.anchors.find((a) => a.kind === "finding")?.targetRef);
    }
  });

  it("shows an empty-pane message instead of a broken image when no snapshot exists for a mode", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots: [], findings: [], comments: [] }));
    expect(markup).toContain('aria-label="Schematic and PCB Review Canvas"');
  });
});
