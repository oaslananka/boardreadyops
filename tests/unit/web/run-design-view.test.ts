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
  it("shows real recorded findings alongside the source artwork in the Run view", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        findings: [
          {
            id: "f1",
            ruleId: "bom.missing-mpn",
            severity: "high",
            message: "C1 has no manufacturer part number.",
            path: "board.kicad_sch",
            kind: undefined,
            waivedAt: undefined,
          },
        ],
        totalFindings: 14,
        repository: "example/hardware",
        commitSha: "a".repeat(40),
      }),
    );
    expect(html).toContain("Recorded findings");
    expect(html).toContain("Finding inspector");
    expect(html).toContain("1 of 14");
    expect(html).toContain("C1 has no manufacturer part number.");
    expect(html).toContain("Supply a verifiable manufacturer part number");
  });

  it("exposes a real recorded base only as a visual comparison, never an engineering verdict", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        baseSnapshots: [{ ...visual, id: "base", sha256: "b".repeat(64) }],
      }),
    );
    expect(html).toContain("1 base views");
    expect(html).toContain("Base/head comparison is a visual overlay");
    expect(html).toContain("not a dimensional or electrical verification");
    expect(html).toContain('title="Overlay with opacity slider"');
    const overlay = html.match(/<button[^>]+title="Overlay with opacity slider"[^>]*>/u)?.[0] ?? "";
    expect(overlay).not.toContain("disabled");
  });

  it("does not compare mismatched design layers or pretend they are the same board view", () => {
    const html = renderToStaticMarkup(
      createElement(RunDesignView, {
        runId: "run-1",
        snapshots: [visual],
        baseSnapshots: [{ ...visual, id: "base", sheetOrLayer: "B.Cu", sha256: "b".repeat(64) }],
      }),
    );
    const overlay = html.match(/<button[^>]+title="Overlay with opacity slider"[^>]*>/u)?.[0] ?? "";
    expect(overlay).toContain("disabled");
    expect(html).toContain("1 base views");
    expect(html).toContain("F.Cu");
    expect(html).toContain("B.Cu");
  });

  it("does not misrepresent a run with no published design IP", () => {
    const html = renderToStaticMarkup(createElement(RunDesignView, { runId: "run-1", snapshots: [] }));
    expect(html).toContain("No PCB or schematic preview published for this run");
    expect(html).toContain("--native-visuals");
    expect(html).toContain("0 KiCad-native");
    expect(html).not.toContain("pcb-copper");
  });
});
