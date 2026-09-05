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

function extractBoardProfile(xml: string, unitFactor: number): NormalizedBoardMetadata {
  const ecadMatch = xml.match(/<Ecad\s+name=["']([^"']+)["']/i);
  const name = ecadMatch?.[1] || "IPC-2581 Board";

  // Find all coordinates in profile / polygon
  const coordsRegex = /<Poly(?:Begin|StepSegment)\s+x=["']([\d.-]+)["']\s+y=["']([\d.-]+)["']/gi;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  let match: RegExpExecArray | null = coordsRegex.exec(xml);
  let pointCount = 0;

  while (match !== null) {
    const x = Number.parseFloat(match[1] || "0");
    const y = Number.parseFloat(match[2] || "0");
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      pointCount++;
    }
    match = coordsRegex.exec(xml);
  }

  const widthMm = pointCount >= 2 ? (maxX - minX) * unitFactor : undefined;
  const heightMm = pointCount >= 2 ? (maxY - minY) * unitFactor : undefined;

  return {
    name,
    ...(widthMm !== undefined && widthMm > 0 ? { widthMm } : {}),
    ...(heightMm !== undefined && heightMm > 0 ? { heightMm } : {}),
  };
}

function extractLayers(xml: string, filename: string): NormalizedLayer[] {
  const layers: NormalizedLayer[] = [];
  const layerRegex = /<Layer\s+([^>]+)>/gi;
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

function extractComponents(
  xml: string,
  bomMap: Map<string, BomCharInfo>,
  unitFactor: number,
  sourceFile: string,
): NormalizedComponent[] {
  const components: NormalizedComponent[] = [];
  const compRegex = /<Component\s+([^>]+)(?:\/>|>([\s\S]*?)<\/Component>)/gi;

  let match: RegExpExecArray | null = compRegex.exec(xml);
  while (match !== null) {
    const attrs = match[1] || "";
    const body = match[2] || "";

    const refMatch = attrs.match(/\brefDes=["']([^"']+)["']/i);
    if (!refMatch?.[1]) {
      match = compRegex.exec(xml);
      continue;
    }

    const refDes = refMatch[1].trim();
    const pkgMatch = attrs.match(/\bpackageRef=["']([^"']+)["']/i);
    const sideMatch = attrs.match(/\bside=["']([^"']+)["']/i);

    const bomInfo = bomMap.get(refDes.toUpperCase());
    const footprint = bomInfo?.footprint || pkgMatch?.[1]?.trim() || "";
    const value = bomInfo?.value || "";
    const mpn = bomInfo?.mpn;
    const side: ComponentSide = sideMatch?.[1]?.toUpperCase() === "BOTTOM" ? "bottom" : "top";

    // Extract Xform (placement coordinates)
    const xformMatch = body.match(/<Xform\s+([^>]+)\/?>/i);
    let xMm: number | undefined;
    let yMm: number | undefined;
    let rotationDegrees: number | undefined;

    if (xformMatch?.[1]) {
      const xAttrs = xformMatch[1];
      const xMatch = xAttrs.match(/\bx=["']([\d.-]+)["']/i);
      const yMatch = xAttrs.match(/\by=["']([\d.-]+)["']/i);
      const rotMatch = xAttrs.match(/\brotation=["']([\d.-]+)["']/i);

      if (xMatch?.[1]) xMm = Number.parseFloat(xMatch[1]) * unitFactor;
      if (yMatch?.[1]) yMm = Number.parseFloat(yMatch[1]) * unitFactor;
      if (rotMatch?.[1]) rotationDegrees = Number.parseFloat(rotMatch[1]);
    }

    const isDnp = /DNP/i.test(value) || (mpn ? /DNP/i.test(mpn) : false);

    components.push({
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
    });

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
