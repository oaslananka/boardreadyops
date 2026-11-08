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
    id: "db-row-1",
    fingerprint: "published-fingerprint-1",
    ruleId: "release.changelog-present",
    severity: "medium",
    message: "CHANGELOG.md is missing.",
    path: "CHANGELOG.md",
    kind: undefined,
    waivedAt: undefined,
  },
  {
    id: "db-row-2",
    fingerprint: "published-fingerprint-2",
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

  it("explains historical virtual reference warnings in the visible list while retaining the source record", () => {
    const original = "#PWR030 is missing an MPN.";
    const first = findings[0];
    const second = findings[1];
    if (!first || !second) throw new Error("fixtures absent");
    const html = render(
      [],
      [
        { ...first, id: "legacy", fingerprint: "virtual", ruleId: "bom.missing-mpn", message: original },
        { ...second, id: "resistor", fingerprint: "real", ruleId: "bom.missing-mpn", message: "R8 is missing an MPN." },
      ],
    );
    expect(html).toContain(original);
    expect(html).toContain("R8 is missing an MPN.");
    expect(html).toContain("Exclude from BOM");
    expect(html.match(/recorded finding/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Run design investigation workspace"');
  });

  it("selects a marker only when the recorded wire fingerprint matches (not its database row ID)", () => {
    const anchors = [
      {
        id: "marker-1",
        kind: "finding" as const,
        targetRef: "C1",
        x: 0.4,
        y: 0.3,
        metadata: { fingerprint: "published-fingerprint-1", ruleId: "release.changelog-present", severity: "medium" },
      },
    ];
    const html = render(anchors);
    expect(html).toContain("This finding has a recorded image anchor");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("ring-2 ring-primary");
  });

  it("does not display stale, missing-page, or invalid-position markers that cannot open a recorded finding", () => {
    const anchor = (id: string, fingerprint: string, x = 0.4, y = 0.3) => ({
      id,
      kind: "finding" as const,
      targetRef: id,
      x,
      y,
      metadata: { fingerprint, ruleId: "design.board-outline", severity: "high" },
    });
    const html = render([
      anchor("VALID_VISIBLE", "published-fingerprint-2"),
      anchor("STALE_ANCHOR", "missing-finding-on-page"),
      anchor("OTHER_PAGE", "fingerprint-from-page-2"),
      anchor("WRONG_ROW_KEY", "db-row-2"),
      anchor("INVALID_POSITION", "published-fingerprint-1", 1.5, 0.3),
      anchor("INVALID_NAN", "published-fingerprint-1", Number.NaN, 0.3),
    ]);
    expect(html).toContain("VALID_VISIBLE");
    expect(html).not.toContain("STALE_ANCHOR");
    expect(html).not.toContain("OTHER_PAGE");
    expect(html).not.toContain("WRONG_ROW_KEY");
    expect(html).not.toContain("INVALID_POSITION");
    expect(html).not.toContain("INVALID_NAN");
    expect(html).toContain("Only markers linked to a unique finding on this page are shown");
  });

  it("hides all ambiguous fingerprint markers while preserving the original artwork", () => {
    const first = findings[0];
    const second = findings[1];
    if (!first || !second) throw new Error("missing findings");
    const html = render(
      [
        {
          id: "DUPLICATE_ANCHOR",
          kind: "finding" as const,
          targetRef: "DUPLICATE_ANCHOR",
          x: 0.1,
          y: 0.3,
          metadata: { fingerprint: "published-fingerprint-1", ruleId: "design.board-outline" },
        },
      ],
      [first, { ...second, fingerprint: first.fingerprint }],
    );
    expect(html).toContain("source-pcb");
    expect(html).not.toContain("DUPLICATE_ANCHOR");
    expect(html).toContain("No verified image coordinate is linked");
  });

  it("never links a marker whose metadata incorrectly contains a database row ID", () => {
    const html = render([
      {
        id: "wrong-key",
        kind: "finding" as const,
        targetRef: "C1",
        x: 0.4,
        y: 0.3,
        metadata: { fingerprint: "db-row-1", ruleId: "release.changelog-present", severity: "medium" },
      },
    ]);
    expect(html).toContain("No verified image coordinate is linked");
    expect(html).not.toContain("ring-2 ring-primary");
  });

  it("rejects absent and duplicate fingerprints instead of selecting the wrong database row", () => {
    const first = findings[0];
    const second = findings[1];
    if (!first || !second) throw new Error("missing finding fixtures");
    const anchors = [
      {
        id: "marker",
        kind: "finding" as const,
        targetRef: "C1",
        x: 0.4,
        y: 0.3,
        metadata: { fingerprint: "published-fingerprint-1", ruleId: "release.changelog-present", severity: "medium" },
      },
    ];
    const missing = render(anchors, [{ ...first, fingerprint: undefined }]);
    const ambiguous = render(anchors, [first, { ...second, fingerprint: first.fingerprint }]);
    expect(missing).toContain("No verified image coordinate is linked");
    expect(ambiguous).toContain("No verified image coordinate is linked");
    expect(missing).not.toContain("ring-2 ring-primary");
    expect(ambiguous).not.toContain("ring-2 ring-primary");
  });

  it("keeps the real desktop and shorter mobile canvas within a readable three-panel investigation", () => {
    const html = render();
    expect(html).toContain("h-[19rem]");
    expect(html).toContain("xl:grid-cols-[minmax(265px,1.05fr)_minmax(0,1.9fr)_minmax(235px,0.95fr)]");
    expect(html).toContain("line-clamp-2");
  });

  it("does not generate a source link from untrusted paths", () => {
    const first = findings[0];
    if (!first) throw new Error("missing finding fixture");
    const html = render([], [{ ...first, path: "../private" }]);
    expect(html).not.toContain("/blob/");
    expect(html).toContain("No verified image coordinate");
  });
});
