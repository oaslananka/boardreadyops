import { createHash } from "node:crypto";
import { HostileInputError } from "../util/errors.js";
import { directChildLists, listHead, listValue, parseKicadDocument } from "./project-model.js";
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

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function scalarArgumentCount(node: SexprListNode): number {
  return node.children.slice(1).filter((child) => child.kind !== "list").length;
}

function parseDecimal(raw: string | undefined): number | undefined {
  if (raw === undefined || !DECIMAL.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function verifiedPlacement(node: SexprListNode): { x: number; y: number; rotation?: number } | undefined {
  // Exact source placement must be scalar x/y and optional scalar rotation.
  // A nested S-expression in the rotation slot is not an omitted angle.
  if (node.children.length < 3 || node.children.length > 4 || node.children.some((child) => child.kind === "list")) {
    return undefined;
  }
  const x = parseDecimal(listValue(node, 1));
  const y = parseDecimal(listValue(node, 2));
  const rotationRaw = listValue(node, 3);
  const rotation = rotationRaw === undefined ? undefined : parseDecimal(rotationRaw);
  if (x === undefined || y === undefined || (rotationRaw !== undefined && rotation === undefined)) return undefined;
  return { x, y, ...(rotation === undefined ? {} : { rotation }) };
}

function validLibraryFootprintId(value: string | undefined): value is string {
  if (!value || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  const parts = value.split(":");
  return parts.length === 2 && parts.every((part) => part.length > 0 && part.trim() === part);
}

function sourceFootprint(node: SexprListNode): VerifiedPcbFootprint | undefined {
  const uuidNode = singleChild(node, "uuid");
  const positionNode = singleChild(node, "at");
  const layerNode = singleChild(node, "layer");
  if (!uuidNode || !positionNode || !layerNode) return undefined;
  const rawUuid = listValue(uuidNode);
  const references = directChildLists(node, "property").filter((child) => listValue(child, 1) === "Reference");
  const referenceProperty = references.length === 1 ? references[0] : undefined;
  const reference =
    referenceProperty && scalarArgumentCount(referenceProperty) === 2 ? listValue(referenceProperty, 2) : undefined;
  // UUID and layer declarations are exact single-scalar fields.
  if (uuidNode.children.length !== 2 || layerNode.children.length !== 2) return undefined;
  const libraryId = listValue(node);
  const layer = listValue(layerNode);
  if (
    !rawUuid ||
    !UUID.test(rawUuid) ||
    !reference ||
    !validLibraryFootprintId(libraryId) ||
    (layer !== "F.Cu" && layer !== "B.Cu")
  ) {
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
  let model: ReturnType<typeof parseKicadDocument>;
  try {
    model = parseKicadDocument(text, "pcb");
  } catch (error) {
    if (error instanceof HostileInputError) return { status: "unavailable", reason: "malformed-source" };
    throw error;
  }
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
