import type {
  IngestionCapabilities,
  LayerRole,
  LayerSide,
  NormalizedBoardMetadata,
  NormalizedDrillHole,
  NormalizedLayer,
  ParserWarning,
} from "@boardreadyops/contracts";

export interface BundleFileEntry {
  filename: string;
  content?: string | undefined;
}

export interface NormalizedStackupResult {
  board: NormalizedBoardMetadata;
  layers: NormalizedLayer[];
  drillHoles: NormalizedDrillHole[];
  capabilities: IngestionCapabilities;
  warnings: ParserWarning[];
}

export function normalizeGerberStackup(files: BundleFileEntry[]): NormalizedStackupResult {
  const layers: NormalizedLayer[] = [];
  const drillHoles: NormalizedDrillHole[] = [];
  const warnings: ParserWarning[] = [];

  let outlineContent: string | undefined;
  let hasPth = false;
  let hasNpth = false;
  let copperLayerCount = 0;

  for (const entry of files) {
    const cleanName = entry.filename.replace(/\\/g, "/");
    const classification = classifyLayer(cleanName);

    if (classification) {
      layers.push({
        name: classification.name,
        role: classification.role,
        side: classification.side,
        index: classification.index,
        filename: entry.filename,
      });

      if (classification.role === "copper") {
        copperLayerCount++;
      } else if (classification.role === "outline") {
        if (entry.content) {
          outlineContent = entry.content;
        }
      } else if (classification.role === "drill") {
        if (/-NPTH/i.test(cleanName)) {
          hasNpth = true;
        } else {
          hasPth = true;
        }
      }
    }
  }

  // Check drill existence
  const hasAnyDrill = layers.some((l) => l.role === "drill");
  if (!hasAnyDrill) {
    warnings.push({
      code: "MISSING_DRILL",
      message: "No NC drill (.drl, .txt, .xln) files were detected in the package.",
    });
  } else if (!hasNpth && hasPth) {
    // Many CAD packages combine PTH and NPTH into a single drill file
    hasNpth = false;
  }

  const hasOutlines = layers.some((l) => l.role === "outline");
  if (!hasOutlines) {
    warnings.push({
      code: "MISSING_OUTLINE",
      message: "No board outline (.gko, .gm1, Edge_Cuts) layer was detected in the package.",
    });
  }

  // Extract board dimensions if outline content is present
  const boardDims = outlineContent ? extractDimensionsFromGerber(outlineContent) : {};

  const board: NormalizedBoardMetadata = {
    name: "Board",
    layerCount: copperLayerCount > 0 ? copperLayerCount : undefined,
    ...(boardDims.widthMm ? { widthMm: boardDims.widthMm } : {}),
    ...(boardDims.heightMm ? { heightMm: boardDims.heightMm } : {}),
  };

  const capabilities: IngestionCapabilities = {
    hasGerberOutlines: hasOutlines,
    hasPlatedHoles: hasPth || hasAnyDrill,
    hasNonPlatedHoles: hasNpth,
    hasBomMapping: false,
    hasCentroidPlacement: false,
    hasNetlistConnectivity: false,
    hasSchematicHierarchies: false,
  };

  return {
    board,
    layers,
    drillHoles,
    capabilities,
    warnings,
  };
}

interface LayerClassification {
  name: string;
  role: LayerRole;
  side: LayerSide;
  index?: number;
}

function classifyLayer(filename: string): LayerClassification | null {
  const lower = filename.toLowerCase();

  // Drill files
  if (/\.(drl|xln|ncd|cnc)$/i.test(lower) || (/\.txt$/i.test(lower) && !/status/i.test(lower))) {
    return { name: "Drill", role: "drill", side: "both" };
  }

  // Outline / Keepout / Mechanical 1
  if (
    /\.(gko|gm1|gm2)$/i.test(lower) ||
    /edge_cuts\.gbr$/i.test(lower) ||
    /boardoutline/i.test(lower) ||
    /profile\.gbr$/i.test(lower)
  ) {
    return { name: "Board Outline", role: "outline", side: "both" };
  }

  // Copper Top
  if (/\.gtl$/i.test(lower) || /[-_]f_cu\.gbr$/i.test(lower) || /copper_top/i.test(lower)) {
    return { name: "Top Copper", role: "copper", side: "top", index: 1 };
  }

  // Copper Bottom
  if (/\.gbl$/i.test(lower) || /[-_]b_cu\.gbr$/i.test(lower) || /copper_bottom/i.test(lower)) {
    return { name: "Bottom Copper", role: "copper", side: "bottom" };
  }

  // Copper Inner
  const innerMatch = lower.match(/\.g(\d+)$/) || lower.match(/[-_]in(\d+)_cu\.gbr$/);
  const innerNum = innerMatch?.[1];
  if (innerNum) {
    const idx = Number.parseInt(innerNum, 10);
    return { name: `Inner Copper ${idx}`, role: "copper", side: "inner", index: idx + 1 };
  }

  // SolderMask Top
  if (/\.gts$/i.test(lower) || /[-_]f_mask\.gbr$/i.test(lower) || /mask_top/i.test(lower)) {
    return { name: "Top Solder Mask", role: "soldermask", side: "top" };
  }

  // SolderMask Bottom
  if (/\.gbs$/i.test(lower) || /[-_]b_mask\.gbr$/i.test(lower) || /mask_bottom/i.test(lower)) {
    return { name: "Bottom Solder Mask", role: "soldermask", side: "bottom" };
  }

  // Silkscreen Top
  if (/\.gto$/i.test(lower) || /[-_]f_silk(?:screen)?\.gbr$/i.test(lower) || /silk_top/i.test(lower)) {
    return { name: "Top Silkscreen", role: "silkscreen", side: "top" };
  }

  // Silkscreen Bottom
  if (/\.gbo$/i.test(lower) || /[-_]b_silk(?:screen)?\.gbr$/i.test(lower) || /silk_bottom/i.test(lower)) {
    return { name: "Bottom Silkscreen", role: "silkscreen", side: "bottom" };
  }

  // SolderPaste Top
  if (/\.gtp$/i.test(lower) || /[-_]f_paste\.gbr$/i.test(lower) || /paste_top/i.test(lower)) {
    return { name: "Top Solder Paste", role: "solderpaste", side: "top" };
  }

  // SolderPaste Bottom
  if (/\.gbp$/i.test(lower) || /[-_]b_paste\.gbr$/i.test(lower) || /paste_bottom/i.test(lower)) {
    return { name: "Bottom Solder Paste", role: "solderpaste", side: "bottom" };
  }

  // Other mechanical or documents
  if (/\.(gm\d+|gbrjob|pdf|csv|step|stp)$/i.test(lower)) {
    return { name: "Documentation", role: "other", side: "none" };
  }

  return null;
}

function extractDimensionsFromGerber(content: string): { widthMm?: number; heightMm?: number } {
  // Format extraction
  let divisor = 100000;
  let isMm = true;

  if (/%MOIN\*%/.test(content)) {
    isMm = false;
  } else if (/%MOMM\*%/.test(content)) {
    isMm = true;
  }

  const formatMatch = content.match(/%FSLAX(\d)(\d)Y(\d)(\d)\*%/);
  const decimalsStr = formatMatch?.[2];
  if (decimalsStr) {
    const decimals = Number.parseInt(decimalsStr, 10);
    divisor = 10 ** decimals;
  }

  const scale = isMm ? 1 / divisor : 25.4 / divisor;

  const coordRegex = /X(-?\d+)Y(-?\d+)/g;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let matches = 0;

  let match = coordRegex.exec(content);
  while (match !== null) {
    const xStr = match[1];
    const yStr = match[2];
    if (xStr !== undefined && yStr !== undefined) {
      const x = Number.parseInt(xStr, 10);
      const y = Number.parseInt(yStr, 10);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      matches++;
    }
    match = coordRegex.exec(content);
  }

  if (matches >= 2 && Number.isFinite(minX) && Number.isFinite(maxX)) {
    const widthMm = (maxX - minX) * scale;
    const heightMm = (maxY - minY) * scale;
    return { widthMm, heightMm };
  }

  return {};
}
