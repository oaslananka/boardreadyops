import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { diffVerifiedObjectPositions } from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";

const uuid = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
const anotherUuid = "c71b2196-ae56-4853-92ac-5497683704cd";
const location = (id: string, x: number, y: number, overrides: Partial<CanvasAnchor> = {}): CanvasAnchor => ({
  id: `a_${id}`,
  kind: "finding",
  layer: "F.Cu",
  x: 0.5,
  y: 0.5,
  metadata: { sourceUuid: id, sourceXmm: x, sourceYmm: y, provenance: "kicad-json-object-position" },
  ...overrides,
});
const snapshot = (anchors: CanvasAnchor[], overrides: Partial<SnapshotArtifact> = {}): SnapshotArtifact => ({
  id: "verified",
  name: "kicad_native_board_F.Cu.svg",
  kind: "pcb_layer",
  format: "svg",
  sheetOrLayer: "board / F.Cu",
  width: 100,
  height: 100,
  sha256: "a".repeat(64),
  anchors,
  ...overrides,
});

describe("verified PCB source-object position delta", () => {
  it("reports exact source UUID position change from absolute KiCad mm, not shifted image pixels", () => {
    const base = snapshot([location(uuid, 145, 92, { x: 0.2, y: 0.3 })]);
    const head = snapshot([location(uuid, 150, 92, { x: 0.95, y: 0.05 })], {
      sha256: "b".repeat(64),
      width: 250,
      height: 180,
    });
    expect(diffVerifiedObjectPositions([base], [head])).toEqual([
      {
        sourceUuid: uuid,
        sheetOrLayer: "board / F.Cu",
        status: "position-moved",
        baseMm: { x: 145, y: 92 },
        headMm: { x: 150, y: 92 },
      },
    ]);
    expect(
      diffVerifiedObjectPositions([base], [snapshot([location(uuid, 145, 92, { x: 0.9, y: 0.9 })])])[0]?.status,
    ).toBe("position-unchanged");
  });

  it("never infers additions or removals from incomplete DRC anchor coverage", () => {
    const first = snapshot([location(uuid, 1, 2)]);
    const second = snapshot([location(anotherUuid, 2, 3)]);
    expect(diffVerifiedObjectPositions([first], [second])).toEqual([]);
    expect(diffVerifiedObjectPositions([], [first])).toEqual([]);
    expect(diffVerifiedObjectPositions([first], [])).toEqual([]);
  });

  it("refuses summary art, different layers and unproven or missing absolute positions", () => {
    const base = snapshot([location(uuid, 1, 2)]);
    expect(diffVerifiedObjectPositions([snapshot([location(uuid, 1, 2)], { name: "pcb_F.Cu.svg" })], [base])).toEqual(
      [],
    );
    expect(
      diffVerifiedObjectPositions(
        [base],
        [
          snapshot([location(uuid, 3, 4)], {
            sheetOrLayer: "board / B.Cu",
          }),
        ],
      ),
    ).toEqual([]);
    expect(
      diffVerifiedObjectPositions(
        [base],
        [
          snapshot([
            location(uuid, 3, 4, {
              metadata: { sourceUuid: uuid, sourceXmm: 3, provenance: "kicad-json-object-position" },
            }),
          ]),
        ],
      ),
    ).toEqual([]);
    expect(
      diffVerifiedObjectPositions(
        [base],
        [
          snapshot([
            location(uuid, 3, 4, {
              metadata: {
                sourceUuid: uuid,
                sourceXmm: Number.NaN,
                sourceYmm: 4,
                provenance: "kicad-json-object-position",
              },
            }),
          ]),
        ],
      ),
    ).toEqual([]);
    expect(
      diffVerifiedObjectPositions(
        [base],
        [
          snapshot([
            location(uuid, 3, 4, {
              metadata: { sourceUuid: uuid, sourceXmm: 3, sourceYmm: 4, provenance: "summary-grid" },
            }),
          ]),
        ],
      ),
    ).toEqual([]);
  });

  it("ignores contradicting positions for the same UUID but de-duplicates identical DRC hits", () => {
    const base = snapshot([location(uuid, 1, 2), location(uuid, 1, 2, { id: "second-finding" })]);
    expect(diffVerifiedObjectPositions([base], [snapshot([location(uuid, 1, 2)])])).toHaveLength(1);
    const conflict = snapshot([location(uuid, 1, 2), location(uuid, 1.5, 2, { id: "conflict" })]);
    expect(diffVerifiedObjectPositions([conflict], [base])).toEqual([]);
    expect(diffVerifiedObjectPositions([base], [conflict])).toEqual([]);
  });

  it("returns deterministic ordering when different reported objects can be compared", () => {
    const before = snapshot([location(anotherUuid, 8, 9), location(uuid, 1, 2)]);
    const after = snapshot([location(uuid, 1, 2), location(anotherUuid, 8, 10)]);
    expect(diffVerifiedObjectPositions([before], [after]).map((item) => [item.sourceUuid, item.status])).toEqual(
      [
        [uuid, "position-unchanged"],
        [anotherUuid, "position-moved"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });
});
