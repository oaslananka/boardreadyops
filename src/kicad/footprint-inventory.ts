import { createHash } from "node:crypto";
import { directChildLists, listHead, listValue, parseKicadDocument, propertyValue } from "./project-model.js";
import type { SexprListNode } from "./sexpr.js";

export interface VerifiedPcbFootprint {
  sourceUuid: string;
  reference: string;
  libraryId: string;
  layer: string;
  positionMm: { x: number; y: number };
  rotationDeg?: number | undefined;
}

export type FootprintInventoryResult =
  | { status: "complete"; sourceSha256: string; footprints: VerifiedPcbFootprint[] }
  | {
      status: "unavailable";
      reason: "malformed-source" | "missing-source-identity" | "duplicate-uuid" | "too-many-footprints";
    };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const MAX_FOOTPRINTS = 10_000;

function sourceFootprint(node: SexprListNode): VerifiedPcbFootprint | undefined {
  const uuidLists = directChildLists(node, "uuid");
  const positionLists = directChildLists(node, "at");
  const layerLists = directChildLists(node, "layer");
  const uuidNode = uuidLists[0];
  const positionNode = positionLists[0];
  const layerNode = layerLists[0];
  if (
    uuidLists.length !== 1 ||
    positionLists.length !== 1 ||
    layerLists.length !== 1 ||
    !uuidNode ||
    !positionNode ||
    !layerNode
  )
    return undefined;
  const uuid = listValue(uuidNode);
  const xStr = listValue(positionNode, 1);
  const yStr = listValue(positionNode, 2);
  const rotationStr = listValue(positionNode, 3);
  const reference = propertyValue(node, "Reference");
  const libraryId = listValue(node);
  const layer = listValue(layerNode);
  if (
    !uuid ||
    !UUID.test(uuid) ||
    !reference ||
    !libraryId ||
    !layer ||
    !/^(?:F|B)\.[\w.]+$/u.test(layer) ||
    xStr === undefined ||
    yStr === undefined ||
    !xStr.trim() ||
    !yStr.trim()
  )
    return undefined;
  const x = Number(xStr);
  const y = Number(yStr);
  const rotation = rotationStr === undefined ? undefined : Number(rotationStr);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (rotation !== undefined && !Number.isFinite(rotation)))
    return undefined;
  return {
    sourceUuid: uuid.toLowerCase(),
    reference,
    libraryId,
    layer,
    positionMm: { x, y },
    ...(rotation === undefined ? {} : { rotationDeg: rotation }),
  };
}

/**
 * All-or-nothing KiCad PCB footprint inventory: no generated identifiers or invented coordinates.
 * Other PCB objects (tracks, vias, pads, zones) and schematics are NOT covered.
 */
export function verifiedPcbFootprintInventory(text: string): FootprintInventoryResult {
  const model = parseKicadDocument(text, "pcb");
  if (
    model.ast.errors.length !== 0 ||
    model.ast.nodes.length !== 1 ||
    !model.root ||
    listHead(model.root) !== "kicad_pcb"
  ) {
    return { status: "unavailable", reason: "malformed-source" };
  }
  const footprints = directChildLists(model.root, "footprint");
  if (footprints.length > MAX_FOOTPRINTS) return { status: "unavailable", reason: "too-many-footprints" };
  const found: VerifiedPcbFootprint[] = [];
  const identities = new Set<string>();
  for (const node of footprints) {
    const parsed = sourceFootprint(node);
    if (!parsed) return { status: "unavailable", reason: "missing-source-identity" };
    if (identities.has(parsed.sourceUuid)) return { status: "unavailable", reason: "duplicate-uuid" };
    identities.add(parsed.sourceUuid);
    found.push(parsed);
  }
  found.sort((a, b) => (a.sourceUuid === b.sourceUuid ? 0 : a.sourceUuid < b.sourceUuid ? -1 : 1));
  return { status: "complete", sourceSha256: createHash("sha256").update(text).digest("hex"), footprints: found };
}
