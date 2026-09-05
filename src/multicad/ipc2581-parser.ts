import type {
  ComponentSide,
  IngestionCapabilities,
  LayerRole,
  LayerSide,
  NetConnection,
  NormalizedBoardMetadata,
  NormalizedComponent,
  NormalizedDrillHole,
  NormalizedLayer,
  NormalizedPcbPackage,
  ParserWarning,
} from "@boardreadyops/contracts";

interface BomCharInfo {
  value?: string | undefined;
  footprint?: string | undefined;
  mpn?: string | undefined;
}

export function parseIpc2581Package(xmlContent: string, sourceFileName = "board.xml"): NormalizedPcbPackage {
  // Security check: Hard reject any DTD or entity declarations (XXE protection)
  assertSafeXml(xmlContent);

  const warnings: ParserWarning[] = [];

  // Extract revision/version
  const revMatch = xmlContent.match(/<IPC-2581[^>]*\s(?:revision|version)=["']([^"']+)["']/i);
  const formatVersion = revMatch?.[1] || "B";

  // Extract units
  const unitFactor = extractUnitFactor(xmlContent);

  // Extract board metadata and profile
  const board = extractBoardProfile(xmlContent, unitFactor);

  // Extract layers / stackup
  const layers = extractLayers(xmlContent, sourceFileName);

  // Extract BOM characteristics
  const bomMap = extractBomCharacteristics(xmlContent);

  // Extract components & placements
  const components = extractComponents(xmlContent, bomMap, unitFactor, sourceFileName);

  // Extract drill holes
  const drillHoles = extractDrillHoles(xmlContent, unitFactor);

  // Extract logical netlist
  const netlist = extractLogicalNetlist(xmlContent);

  const capabilities: IngestionCapabilities = {
    hasGerberOutlines:
      layers.some((l) => l.role === "outline") || (board.widthMm !== undefined && board.heightMm !== undefined),
    hasPlatedHoles: drillHoles.some((h) => h.plated),
    hasNonPlatedHoles: drillHoles.some((h) => !h.plated),
    hasBomMapping: components.length > 0,
    hasCentroidPlacement: components.some((c) => c.xMm !== undefined),
    hasNetlistConnectivity: Object.keys(netlist).length > 0,
    hasSchematicHierarchies: false,
  };

  return {
    format: "ipc2581",
    formatVersion,
    sourceType: "upload_bundle",
    capabilities,
    board,
    layers,
    components,
    drillHoles,
    ...(Object.keys(netlist).length > 0 ? { netlist } : {}),
    parserWarnings: warnings,
  };
}

function assertSafeXml(xml: string): void {
  const upper = xml.toUpperCase();
  if (upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) {
    throw new Error("Malicious XML content detected: DOCTYPE and ENTITY declarations are forbidden (XXE protection)");
  }
}

function extractUnitFactor(xml: string): number {
  const match = xml.match(/\bunits=["']([^"']+)["']/i);
  if (!match?.[1]) return 1.0;
  const unit = match[1].toUpperCase();
  if (unit === "INCH" || unit === "INCHES") return 25.4;
  if (unit === "MIL" || unit === "MILS") return 0.0254;
  if (unit === "MICRON" || unit === "MICRONS" || unit === "UM") return 0.001;
  return 1.0; // MILLIMETER
}

interface ProfileBoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

function profileBoundingBox(xml: string): ProfileBoundingBox {
  const coordsRegex = /<Poly(?:Begin|StepSegment)\s+x=["']([\d.-]+)["']\s+y=["']([\d.-]+)["']/gi;
  const box: ProfileBoundingBox = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    count: 0,
  };

  let match = coordsRegex.exec(xml);
  while (match !== null) {
    const x = Number.parseFloat(match[1] || "0");
    const y = Number.parseFloat(match[2] || "0");
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      box.count += 1;
    }
    match = coordsRegex.exec(xml);
  }

  return box;
}

function extractBoardProfile(xml: string, unitFactor: number): NormalizedBoardMetadata {
  const name = /<Ecad\s+name=["']([^"']+)["']/i.exec(xml)?.[1] || "IPC-2581 Board";
  const box = profileBoundingBox(xml);

  const widthMm = box.count >= 2 ? (box.maxX - box.minX) * unitFactor : undefined;
  const heightMm = box.count >= 2 ? (box.maxY - box.minY) * unitFactor : undefined;

  return {
    name,
    ...(widthMm !== undefined && widthMm > 0 ? { widthMm } : {}),
    ...(heightMm !== undefined && heightMm > 0 ? { heightMm } : {}),
  };
}

function extractLayers(xml: string, filename: string): NormalizedLayer[] {
  const layers: NormalizedLayer[] = [];
  // Attribute run is bounded (real IPC-2581 <Layer> tags never approach this) so a crafted
  // file with many unclosed "<Layer " occurrences can't force quadratic backtracking.
  const layerRegex = /<Layer\s+([^>]{1,4096})>/gi;
  let match: RegExpExecArray | null = layerRegex.exec(xml);

  while (match !== null) {
    const attrStr = match[1] || "";
    const nameMatch = attrStr.match(/\bname=["']([^"']+)["']/i);
    const funcMatch = attrStr.match(/\blayerFunction=["']([^"']+)["']/i);
    const sideMatch = attrStr.match(/\bside=["']([^"']+)["']/i);
    const seqMatch = attrStr.match(/\bsequence=["'](\d+)["']/i);

    if (nameMatch?.[1]) {
      const rawName = nameMatch[1];
      const rawFunc = funcMatch?.[1] || "";
      const rawSide = sideMatch?.[1] || "";
      const role = mapLayerFunctionToRole(rawFunc);
      const side = mapLayerSide(rawSide);
      const index = seqMatch?.[1] ? Number.parseInt(seqMatch[1], 10) : undefined;

      layers.push({
        name: rawName,
        role,
        side,
        ...(index !== undefined && index > 0 ? { index } : {}),
        filename,
      });
    }
    match = layerRegex.exec(xml);
  }

  return layers;
}

function mapLayerFunctionToRole(fn: string): LayerRole {
  const upper = fn.toUpperCase();
  if (upper.includes("CONDUCTOR") || upper.includes("SIGNAL") || upper.includes("PLANE")) return "copper";
  if (upper.includes("SOLDERMASK") || upper.includes("MASK")) return "soldermask";
  if (upper.includes("LEGEND") || upper.includes("SILKSCREEN") || upper.includes("SILK")) return "silkscreen";
  if (upper.includes("PASTE")) return "solderpaste";
  if (upper.includes("DRILL") || upper.includes("ROUT")) return "drill";
  if (upper.includes("DOCUMENT") || upper.includes("OUTLINE") || upper.includes("PROFILE")) return "outline";
  return "other";
}

function mapLayerSide(side: string): LayerSide {
  const upper = side.toUpperCase();
  if (upper === "TOP") return "top";
  if (upper === "BOTTOM") return "bottom";
  if (upper === "INTERNAL" || upper === "INNER") return "inner";
  if (upper === "BOTH") return "both";
  return "none";
}

function extractBomCharacteristics(xml: string): Map<string, BomCharInfo> {
  const bomMap = new Map<string, BomCharInfo>();
  const bomItemRegex = /<BomItem[^>]*>([\s\S]*?)<\/BomItem>/gi;

  let itemMatch: RegExpExecArray | null = bomItemRegex.exec(xml);
  while (itemMatch !== null) {
    const itemContent = itemMatch[1] || "";
    const refMatch = itemContent.match(/<ComponentRef\s+componentRef=["']([^"']+)["']/i);
    if (refMatch?.[1]) {
      const refDes = refMatch[1].trim();
      const valMatch = itemContent.match(/<Characteristic[^>]*name=["']VALUE["'][^>]*value=["']([^"']+)["']/i);
      const pkgMatch = itemContent.match(/<Characteristic[^>]*name=["']PACKAGE["'][^>]*value=["']([^"']+)["']/i);
      const mpnMatch = itemContent.match(
        /<Characteristic[^>]*name=["'](?:MPN|PART_NUMBER|PART_NO)["'][^>]*value=["']([^"']+)["']/i,
      );

      bomMap.set(refDes.toUpperCase(), {
        value: valMatch?.[1]?.trim(),
        footprint: pkgMatch?.[1]?.trim(),
        mpn: mpnMatch?.[1]?.trim(),
      });
    }
    itemMatch = bomItemRegex.exec(xml);
  }

  return bomMap;
}

interface XformPlacement {
  xMm: number | undefined;
  yMm: number | undefined;
  rotationDegrees: number | undefined;
}

function extractXform(body: string, unitFactor: number): XformPlacement {
  const placement: XformPlacement = { xMm: undefined, yMm: undefined, rotationDegrees: undefined };
  const xformAttrs = /<Xform\s+([^>]{1,4096})\/?>/i.exec(body)?.[1];
  if (!xformAttrs) return placement;

  const xMatch = /\bx=["']([\d.-]+)["']/i.exec(xformAttrs)?.[1];
  const yMatch = /\by=["']([\d.-]+)["']/i.exec(xformAttrs)?.[1];
  const rotMatch = /\brotation=["']([\d.-]+)["']/i.exec(xformAttrs)?.[1];

  if (xMatch) placement.xMm = Number.parseFloat(xMatch) * unitFactor;
  if (yMatch) placement.yMm = Number.parseFloat(yMatch) * unitFactor;
  if (rotMatch) placement.rotationDegrees = Number.parseFloat(rotMatch);
  return placement;
}

function buildComponent(
  attrs: string,
  body: string,
  bomMap: Map<string, BomCharInfo>,
  unitFactor: number,
  sourceFile: string,
): NormalizedComponent | null {
  const refDes = /\brefDes=["']([^"']+)["']/i.exec(attrs)?.[1]?.trim();
  if (!refDes) return null;

  const pkgMatch = /\bpackageRef=["']([^"']+)["']/i.exec(attrs)?.[1];
  const sideMatch = /\bside=["']([^"']+)["']/i.exec(attrs)?.[1];

  const bomInfo = bomMap.get(refDes.toUpperCase());
  const footprint = bomInfo?.footprint || pkgMatch?.trim() || "";
  const value = bomInfo?.value || "";
  const mpn = bomInfo?.mpn;
  const side: ComponentSide = sideMatch?.toUpperCase() === "BOTTOM" ? "bottom" : "top";

  const { xMm, yMm, rotationDegrees } = extractXform(body, unitFactor);
  const isDnp = /DNP/i.test(value) || (mpn ? /DNP/i.test(mpn) : false);

  return {
    refDes,
    value,
    footprint,
    ...(mpn ? { mpn } : {}),
    side,
    ...(xMm !== undefined && !Number.isNaN(xMm) ? { xMm } : {}),
    ...(yMm !== undefined && !Number.isNaN(yMm) ? { yMm } : {}),
    ...(rotationDegrees !== undefined && !Number.isNaN(rotationDegrees) ? { rotationDegrees } : {}),
    dnp: isDnp,
    sourceFile,
  };
}

function extractComponents(
  xml: string,
  bomMap: Map<string, BomCharInfo>,
  unitFactor: number,
  sourceFile: string,
): NormalizedComponent[] {
  const components: NormalizedComponent[] = [];
  // The attribute run is bounded for the same reason as extractLayers's layerRegex above: on
  // a crafted file with many unclosed "<Component " occurrences, an unbounded attribute group
  // makes every failed attempt scan to end-of-string, which is quadratic under the global exec
  // loop. Bounding it makes a failed attempt fail fast instead, without limiting how large a
  // real (well-formed) component's own body content can be -- that group stays unbounded.
  const compRegex = /<Component\s+([^>]{1,4096})(?:\/>|>([\s\S]*?)<\/Component>)/gi;

  let match = compRegex.exec(xml);
  while (match !== null) {
    const component = buildComponent(match[1] || "", match[2] || "", bomMap, unitFactor, sourceFile);
    if (component) components.push(component);
    match = compRegex.exec(xml);
  }

  return components;
}

function extractDrillHoles(xml: string, unitFactor: number): NormalizedDrillHole[] {
  const holes: NormalizedDrillHole[] = [];
  const holeRegex = /<Hole\s+([^>]+)\/?>/gi;

  let match: RegExpExecArray | null = holeRegex.exec(xml);
  while (match !== null) {
    const attrs = match[1] || "";
    const xMatch = attrs.match(/\bx=["']([\d.-]+)["']/i);
    const yMatch = attrs.match(/\by=["']([\d.-]+)["']/i);
    const dMatch = attrs.match(/\bdiameter=["']([\d.-]+)["']/i);
    const platedMatch = attrs.match(/\bplating=["']([^"']+)["']/i);

    if (xMatch?.[1] && yMatch?.[1] && dMatch?.[1]) {
      const x = Number.parseFloat(xMatch[1]) * unitFactor;
      const y = Number.parseFloat(yMatch[1]) * unitFactor;
      const dia = Number.parseFloat(dMatch[1]) * unitFactor;
      const plated = platedMatch?.[1]?.toUpperCase() !== "NON_PLATED";

      if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(dia) && dia > 0) {
        holes.push({
          xMm: x,
          yMm: y,
          diameterMm: dia,
          plated,
        });
      }
    }
    match = holeRegex.exec(xml);
  }

  return holes;
}

function extractLogicalNetlist(xml: string): Record<string, NetConnection[]> {
  const netlist: Record<string, NetConnection[]> = {};
  const netRegex = /<Net\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Net>/gi;

  let netMatch: RegExpExecArray | null = netRegex.exec(xml);
  while (netMatch !== null) {
    const netName = netMatch[1] || "";
    const netBody = netMatch[2] || "";

    const connections: NetConnection[] = [];
    const nodeRegex = /<(?:Node|Pin)\s+componentRef=["']([^"']+)["']\s+pin=["']([^"']+)["']/gi;

    let nodeMatch: RegExpExecArray | null = nodeRegex.exec(netBody);
    while (nodeMatch !== null) {
      const componentRef = nodeMatch[1] || "";
      const pin = nodeMatch[2] || "";
      if (componentRef && pin) {
        connections.push({ componentRef, pin });
      }
      nodeMatch = nodeRegex.exec(netBody);
    }

    if (netName && connections.length > 0) {
      netlist[netName] = connections;
    }

    netMatch = netRegex.exec(xml);
  }

  return netlist;
}
