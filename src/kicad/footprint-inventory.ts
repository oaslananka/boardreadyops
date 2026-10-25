import { createHash } from "node:crypto";
import { directChildLists, listHead, listValue, parseKicadDocument, propertyValue } from "./project-model.js";
import type { SexprListNode } from "./sexpr.js";

interface VerifiedPcbFootprint {
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

function singleChild(node: SexprListNode, name: string): SexprListNode | undefined {
  const matches = directChildLists(node, name);
  return matches.length === 1 ? matches[0] : undefined;
}

function verifiedPlacement(node: SexprListNode): { x: number; y: number; rotation?: number } | undefined {
  const xRaw = listValue(node, 1);
  const yRaw = listValue(node, 2);
  const rotationRaw = listValue(node, 3);
  if (!xRaw?.trim() || !yRaw?.trim()) return undefined;
  const x = Number(xRaw);
  const y = Number(yRaw);
  const rotation = rotationRaw === undefined ? undefined : Number(rotationRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (rotation !== undefined && !Number.isFinite(rotation))) {
    return undefined;
  }
  return { x, y, ...(rotation === undefined ? {} : { rotation }) };
}

function sourceFootprint(node: SexprListNode): VerifiedPcbFootprint | undefined {
  const uuidNode = singleChild(node, "uuid");
  const positionNode = singleChild(node, "at");
  const layerNode = singleChild(node, "layer");
  if (!uuidNode || !positionNode || !layerNode) return undefined;
  const rawUuid = listValue(uuidNode);
  const reference = propertyValue(node, "Reference");
  const libraryId = listValue(node);
  const layer = listValue(layerNode);
  if (!rawUuid || !UUID.test(rawUuid) || !reference || !libraryId || !layer || !/^[FB]\.[\w.]+$/u.test(layer)) {
    return undefined;
  }
  const place = verifiedPlacement(positionNode);
  if (!place) return undefined;
  return {
    sourceUuid: rawUuid.toLowerCase(),
    reference,
    libraryId,
    layer,
    positionMm: { x: place.x, y: place.y },
    ...(place.rotation === undefined ? {} : { rotationDeg: place.rotation }),
  };
}

function compareSourceUuids(a: VerifiedPcbFootprint, b: VerifiedPcbFootprint): number {
  if (a.sourceUuid === b.sourceUuid) return 0;
  return a.sourceUuid < b.sourceUuid ? -1 : 1;
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
  found.sort(compareSourceUuids);
  return { status: "complete", sourceSha256: createHash("sha256").update(text).digest("hex"), footprints: found };
}
