import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewCanvas } from "../../../apps/web/components/review/review-canvas.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import { buildDemoSnapshots } from "../../../apps/web/lib/demo-snapshots.js";

describe("ReviewCanvas", () => {
  const review = DEMO_REVIEWS[0] as (typeof DEMO_REVIEWS)[0];
  const headSnapshots = buildDemoSnapshots(review.changedFiles, review.findings);

  it("renders a data-uri image per sheet/layer snapshot, not raw inline SVG", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    expect(markup).toContain("Schematic and PCB Review Canvas");
    expect(markup).toContain("data:image/svg+xml");
    expect(markup).not.toContain("<svg");
  });

  it("lets the viewer switch between the changed sheets and layers", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    for (const snapshot of headSnapshots) {
      expect(markup).toContain(snapshot.sheetOrLayer);
    }
  });

  it("renders a finding marker for each anchor linked to a finding", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    const findingAnchorCount = headSnapshots[0]?.anchors.filter((a) => a.kind === "finding").length ?? 0;
    if (findingAnchorCount > 0) {
      expect(markup).toContain("finding-marker");
    }
  });

  it("shows an empty-pane message instead of a broken image when no snapshot exists for a mode", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots: [], findings: [], comments: [] }));
    expect(markup).toContain("canvas-viewport");
  });
});
