import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDesignView } from "../../../apps/web/components/run-design-view.js";

const visual = {
  id: "svg1",
  name: "kicad_native_F_Cu.svg",
  kind: "pcb_layer" as const,
  format: "svg" as const,
  sheetOrLayer: "F.Cu",
  width: 100,
  height: 100,
  content: '<svg viewBox="0 0 100 100"><path id="pcb-copper" /></svg>',
  sha256: "a".repeat(64),
  anchors: [],
};

describe("run design visual inspection", () => {
  it("renders genuinely published KiCad artwork with no fabricated markers or readiness claim", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        reviewId: "review-1",
      }),
    );
    expect(html).toContain('aria-label="Run design inspection"');
    expect(html).toContain("PCB &amp; schematic inspection");
    expect(html).toContain("1 KiCad-native");
    expect(html).toContain("pcb-copper");
    expect(html).toContain("Finding coordinates are not inferred");
    expect(html).toContain("/runs/run-1/findings");
    expect(html).toContain("/reviews/review-1");
  });
  it("does not misrepresent a run with no published design IP", () => {
    const html = renderToStaticMarkup(createElement(RunDesignView, { runId: "run-1", snapshots: [] }));
    expect(html).toContain("No PCB or schematic preview published for this run");
    expect(html).toContain("--native-visuals");
    expect(html).toContain("0 KiCad-native");
    expect(html).not.toContain("pcb-copper");
  });
});
