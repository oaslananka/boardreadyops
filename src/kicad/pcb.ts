import { readDesignFile } from "./parsers/project-files.js";
import type { KiCadDocumentModel } from "./project-model.js";
import {
  descendantScalars,
  directChildLists,
  findKiCadLists,
  listChildValue,
  listHead,
  listValue,
  parseKicadDocument,
  propertyValue,
  sourceText,
} from "./project-model.js";
import type { SexprListNode } from "./sexpr.js";

export interface PcbFootprint {
  reference: string;
  footprint: string;
  dnp: boolean;
  boardOnly: boolean;
  layers: string[];
  at?:
    | {
        x: number;
        y: number;
        rotation?: number | undefined;
      }
    | undefined;
}

export interface ParsedPcb {
  footprints: PcbFootprint[];
  revision?: string | undefined;
  drillSizes: string[];
  copperLayers: string[];
  copperAreas: Map<string, number>;
  boardArea?: number | undefined;
  outlineClosed: boolean;
  copperLayerCount: number;
  stackupLayerCount?: number | undefined;
  designBlockInstances: number;
}

export async function parsePcb(file: string): Promise<ParsedPcb> {
  const text = (await readDesignFile(file)) ?? "";
  const model = parseKicadDocument(text, "pcb");
  const copperLayerNames = copperLayers(model);
  return {
    footprints: footprints(model),
    revision: revision(model),
    drillSizes: drillSizes(model),
    copperLayers: copperLayerNames,
    copperAreas: copperAreas(model),
    boardArea: boardArea(model),
    outlineClosed: isOutlineClosed(model),
    copperLayerCount: copperLayerNames.length,
    stackupLayerCount: stackupLayerCount(model),
    designBlockInstances: findKiCadLists(model, "design_block_instance").length,
  };
}

function footprints(model: KiCadDocumentModel): PcbFootprint[] {
  const parsed: PcbFootprint[] = [];
  for (const footprint of findKiCadLists(model, "footprint")) {
    const reference = propertyValue(footprint, "Reference");
    if (!reference) {
      continue;
    }
    const attributes = new Set(directChildLists(footprint, "attr").flatMap((attr) => descendantScalars(attr).slice(1)));
    parsed.push({
      reference,
      footprint: listValue(footprint) ?? "",
      dnp: attributes.has("dnp") || /not\s+populated/i.test(sourceText(model, footprint)),
      boardOnly: attributes.has("board_only"),
      layers: findKiCadLists(footprint, "layer")
        .map((layer) => listValue(layer) ?? "")
        .filter(Boolean),
      at: footprintPosition(footprint),
    });
  }
  return parsed;
}

function footprintPosition(footprint: SexprListNode): PcbFootprint["at"] {
  const at = directChildLists(footprint, "at")[0];
  if (!at) {
    return undefined;
  }
  const x = Number(listValue(at, 1));
  const y = Number(listValue(at, 2));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  const rotation = Number(listValue(at, 3));
  return { x, y, ...(Number.isFinite(rotation) ? { rotation } : {}) };
}

function revision(model: KiCadDocumentModel): string | undefined {
  const titleBlock = findKiCadLists(model, "title_block")[0];
  return (
    (titleBlock ? listChildValue(titleBlock, "rev") : undefined) ??
    firstListValue(model, "rev") ??
    firstListValue(model, "revision")
  );
}

function drillSizes(model: KiCadDocumentModel): string[] {
  return findKiCadLists(model, "drill")
    .map((drill) => listValue(drill))
    .filter((value): value is string => Boolean(value && Number.isFinite(Number(value))));
}

function copperLayers(model: KiCadDocumentModel): string[] {
  const layerBlock = findKiCadLists(model, "layers")[0];
  if (layerBlock) {
    const layers = directChildLists(layerBlock)
      .filter((layer) => /^\d+$/.test(listHead(layer) ?? ""))
      .filter((layer) => ["signal", "power"].includes(listValue(layer, 2) ?? ""))
      .map((layer) => listValue(layer, 1) ?? "")
      .filter(Boolean);
    if (layers.length > 0) {
      return [...new Set(layers)];
    }
  }
  return [
    ...new Set(
      findKiCadLists(model, "layer")
        .map((layer) => listValue(layer) ?? "")
        .filter((layer) => layer.endsWith(".Cu")),
    ),
  ];
}

function copperAreas(model: KiCadDocumentModel): Map<string, number> {
  const areas = new Map<string, number>();
  for (const zone of findKiCadLists(model, "zone")) {
    const layer = layerName(zone);
    if (!layer) {
      continue;
    }
    for (const polygon of findKiCadLists(zone, "filled_polygon")) {
      const area = polygonAreaFromList(polygon);
      if (area > 0) {
        areas.set(layer, (areas.get(layer) ?? 0) + area);
      }
    }
  }
  return areas;
}

function boardArea(model: KiCadDocumentModel): number | undefined {
  const rect = edgePrimitiveLists(model, "gr_rect")
    .map((block) => startEndFromList(block))
    .find((segment): segment is Segment => Boolean(segment));
  if (rect) {
    return Math.abs((rect.end.x - rect.start.x) * (rect.end.y - rect.start.y));
  }
  const circle = edgePrimitiveLists(model, "gr_circle")
    .map((block) => circleRadiusPoints(block))
    .find((segment): segment is Segment => Boolean(segment));
  if (circle) {
    const radius = distance(circle.start, circle.end);
    return Math.PI * radius * radius;
  }
  return orderedLoopArea(edgeSegments(model));
}

function isOutlineClosed(model: KiCadDocumentModel): boolean {
  if (edgePrimitiveLists(model, "gr_rect").length > 0 || edgePrimitiveLists(model, "gr_circle").length > 0) {
    return true;
  }
  const counts = new Map<string, number>();
  for (const segment of edgeSegments(model)) {
    for (const point of [segment.start, segment.end]) {
      const key = `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts.size > 0 && [...counts.values()].every((count) => count === 2);
}

function stackupLayerCount(model: KiCadDocumentModel): number | undefined {
  const stackup = findKiCadLists(model, "stackup")[0];
  if (!stackup) {
    return undefined;
  }
  return findKiCadLists(stackup, "layer").filter((layer) => (listValue(layer) ?? "").endsWith(".Cu")).length;
}

interface Point {
  x: number;
  y: number;
}

interface Segment {
  start: Point;
  end: Point;
}

function edgeSegments(model: KiCadDocumentModel): Segment[] {
  return [...edgePrimitiveLists(model, "gr_line"), ...edgePrimitiveLists(model, "gr_arc")]
    .map(startEndFromList)
    .filter((segment): segment is Segment => Boolean(segment));
}

function edgePrimitiveLists(model: KiCadDocumentModel, head: string): SexprListNode[] {
  return findKiCadLists(model, head).filter((block) => layerName(block) === "Edge.Cuts");
}

function startEndFromList(list: SexprListNode): Segment | undefined {
  const start = pointFromChild(list, "start");
  const end = pointFromChild(list, "end");
  if (!start || !end) {
    return undefined;
  }
  return { start, end };
}

function circleRadiusPoints(list: SexprListNode): Segment | undefined {
  const center = pointFromChild(list, "center");
  const end = pointFromChild(list, "end");
  if (!center || !end) {
    return undefined;
  }
  return { start: center, end };
}

function pointFromChild(list: SexprListNode, head: string): Point | undefined {
  const child = directChildLists(list, head)[0];
  return child ? pointFromList(child) : undefined;
}

function pointFromList(list: SexprListNode): Point | undefined {
  const x = Number(listValue(list, 1));
  const y = Number(listValue(list, 2));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x, y };
}

function layerName(list: SexprListNode): string | undefined {
  return listChildValue(list, "layer");
}

function polygonAreaFromList(list: SexprListNode): number {
  const pointSets = findKiCadLists(list, "pts")
    .map(pointsFromList)
    .filter((points) => points.length >= 3);
  if (pointSets.length === 0) {
    return 0;
  }
  const outer = pointSets[0] as Point[];
  const holes = pointSets.slice(1);
  return Math.max(0, polygonArea(outer) - holes.reduce((sum, points) => sum + polygonArea(points), 0));
}

function orderedLoopArea(segments: Segment[]): number | undefined {
  if (segments.length < 3) {
    return undefined;
  }
  const unused = [...segments];
  const areas: number[] = [];
  while (unused.length > 0) {
    const first = unused.shift() as Segment;
    const points = [first.start, first.end];
    while (!samePoint(points[0] as Point, points.at(-1) as Point)) {
      const tail = points.at(-1) as Point;
      const nextIndex = unused.findIndex((segment) => samePoint(segment.start, tail) || samePoint(segment.end, tail));
      if (nextIndex === -1) {
        return undefined;
      }
      const [next] = unused.splice(nextIndex, 1) as [Segment];
      points.push(samePoint(next.start, tail) ? next.end : next.start);
    }
    areas.push(polygonArea(points.slice(0, -1)));
  }
  const [outer, ...holes] = areas.toSorted((left, right) => right - left);
  if (!outer) {
    return undefined;
  }
  return Math.max(0, outer - holes.reduce((sum, area) => sum + area, 0));
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function pointsFromList(list: SexprListNode): Point[] {
  return directChildLists(list, "xy")
    .map(pointFromList)
    .filter((point): point is Point => Boolean(point));
}

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length];
    if (next) {
      sum += point.x * next.y - next.x * point.y;
    }
  }
  return Math.abs(sum / 2);
}

function firstListValue(model: KiCadDocumentModel, head: string): string | undefined {
  const list = findKiCadLists(model, head)[0];
  return list ? listValue(list) : undefined;
}
