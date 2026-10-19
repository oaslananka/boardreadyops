import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDesignWorkspace } from "../../../apps/web/components/run-design-workspace.js";

const sha = "a".repeat(40);
const artwork = {
  id: "pcb-layer-1",
  name: "kicad_native_F_Cu.svg",
  kind: "pcb_layer" as const,
  format: "svg" as const,
  sheetOrLayer: "F.Cu",
  width: 100,
  height: 100,
  content: '<svg viewBox="0 0 100 100"><path id="source-pcb" /></svg>',
  sha256: "b".repeat(64),
  anchors: [],
};
const findings = [
  {
    id: "recorded-1",
    ruleId: "release.changelog-present",
    severity: "medium",
    message: "CHANGELOG.md is missing.",
    path: "CHANGELOG.md",
    kind: undefined,
    waivedAt: undefined,
  },
  {
    id: "recorded-2",
    ruleId: "design.board-outline",
    severity: "high",
    message: "PCB outline is open.",
    path: "gateway.kicad_pcb",
    kind: undefined,
    waivedAt: undefined,
  },
];

function render(anchors = artwork.anchors, customFindings = findings) {
  return renderToStaticMarkup(
    createElement(RunDesignWorkspace, {
      snapshots: [{ ...artwork, anchors }],
      findings: customFindings,
      totalFindings: 14,
      repository: "example/hardware",
      commitSha: sha,
    }),
  );
}

describe("recorded run design workspace", () => {
  it("combines actual run artwork, paged findings and source-scoped remediation without inferred positions", () => {
    const html = render();
    expect(html).toContain('aria-label="Run design investigation workspace"');
    expect(html).toContain('aria-label="Selected run finding"');
    expect(html).toContain("source-pcb");
    expect(html).toContain("2 of 14");
    expect(html).toContain("PCB outline is open.");
    expect(html).toContain("Add or update CHANGELOG.md");
    expect(html).toContain(`https://github.com/example/hardware/blob/${sha}/CHANGELOG.md`);
    expect(html).toContain("No verified image coordinate is linked to this finding");
    expect(html).not.toContain("edit CAD");
  });

  it("highlights a physical location only with an exact persisted finding identifier", () => {
    const anchors = [
      {
        id: "marker-1",
        kind: "finding" as const,
        targetRef: "C1",
        x: 0.4,
        y: 0.3,
        metadata: { fingerprint: "recorded-1", ruleId: "release.changelog-present", severity: "medium" },
      },
    ];
    const html = render(anchors);
    expect(html).toContain("This finding has a recorded image anchor");
    expect(html).toContain('aria-pressed="true"');
  });

  it("does not generate a source link from untrusted paths", () => {
    const first = findings[0];
    if (!first) throw new Error("missing finding fixture");
    const html = render([], [{ ...first, path: "../private" }]);
    expect(html).not.toContain("/blob/");
    expect(html).toContain("No verified image coordinate");
  });
});
