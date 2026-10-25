import type { FootprintInventoryResult } from "./footprint-inventory.js";
import { verifiedPcbFootprintInventory } from "./footprint-inventory.js";

type VerifiedFootprint = Extract<FootprintInventoryResult, { status: "complete" }>["footprints"][number];

type VerifiedFootprintChangeField = "reference" | "libraryId" | "layer" | "positionMm" | "rotationDeg";

type VerifiedFootprintChange =
  | { status: "footprint-added"; sourceUuid: string; head: VerifiedFootprint }
  | { status: "footprint-removed"; sourceUuid: string; base: VerifiedFootprint }
  | {
      status: "footprint-modified";
      sourceUuid: string;
      changedFields: VerifiedFootprintChangeField[];
      base: VerifiedFootprint;
      head: VerifiedFootprint;
    };

export type VerifiedFootprintDiffResult =
  | {
      status: "complete";
      baseSourceSha256: string;
      headSourceSha256: string;
      changes: VerifiedFootprintChange[];
    }
  | {
      status: "unavailable";
      side: "base" | "head";
      reason: Extract<FootprintInventoryResult, { status: "unavailable" }>["reason"];
    };

function changedFields(before: VerifiedFootprint, after: VerifiedFootprint): VerifiedFootprintChangeField[] {
  const fields: VerifiedFootprintChangeField[] = [];
  if (before.reference !== after.reference) fields.push("reference");
  if (before.libraryId !== after.libraryId) fields.push("libraryId");
  if (before.layer !== after.layer) fields.push("layer");
  if (before.positionMm.x !== after.positionMm.x || before.positionMm.y !== after.positionMm.y) {
    fields.push("positionMm");
  }
  if (before.rotationDeg !== after.rotationDeg) fields.push("rotationDeg");
  return fields;
}

/**
 * Source-factual footprint-only delta; not an electrical, DRC, or fabrication verdict.
 *
 * Both entire PCB sources must yield a complete, validated footprint inventory.
 * Never infer added/removed objects from incomplete DRC finding anchors or SVG pixels.
 * A changed UUID counts as a removal and an addition even when the reference matches.
 */
export function diffVerifiedPcbFootprints(basePcb: string, headPcb: string): VerifiedFootprintDiffResult {
  const base = verifiedPcbFootprintInventory(basePcb);
  if (base.status !== "complete") return { status: "unavailable", side: "base", reason: base.reason };
  const head = verifiedPcbFootprintInventory(headPcb);
  if (head.status !== "complete") return { status: "unavailable", side: "head", reason: head.reason };

  const beforeById = new Map(base.footprints.map((item) => [item.sourceUuid, item]));
  const afterById = new Map(head.footprints.map((item) => [item.sourceUuid, item]));
  const changes: VerifiedFootprintChange[] = [];
  for (const item of base.footprints) {
    const after = afterById.get(item.sourceUuid);
    if (!after) {
      changes.push({ status: "footprint-removed", sourceUuid: item.sourceUuid, base: item });
      continue;
    }
    const fields = changedFields(item, after);
    if (fields.length > 0) {
      changes.push({
        status: "footprint-modified",
        sourceUuid: item.sourceUuid,
        changedFields: fields,
        base: item,
        head: after,
      });
    }
  }
  for (const item of head.footprints) {
    if (!beforeById.has(item.sourceUuid)) {
      changes.push({ status: "footprint-added", sourceUuid: item.sourceUuid, head: item });
    }
  }
  changes.sort((a, b) => (a.sourceUuid === b.sourceUuid ? 0 : a.sourceUuid < b.sourceUuid ? -1 : 1));
  return {
    status: "complete",
    baseSourceSha256: base.sourceSha256,
    headSourceSha256: head.sourceSha256,
    changes,
  };
}
