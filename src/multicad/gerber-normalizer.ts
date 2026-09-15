import type {
  IngestionCapabilities,
  LayerRole,
  LayerSide,
  NormalizedBoardMetadata,
  NormalizedDrillHole,
  NormalizedLayer,
  ParserWarning,
} from "@boardreadyops/contracts";
import { parseExcellon } from "./excellon-parser.js";
import { parseGerber } from "./gerber-parser.js";

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

interface LayerAccumulation {
  layers: NormalizedLayer[];
  /** Board extents and outline closure, read from the profile layer's own artwork. */
  outline: { boundingBoxMm: BoundingBoxMm | undefined; closed: boolean; openContours: number } | undefined;
  copperLayerCount: number;
  /** Every drill entry, with content where the caller supplied it. Plating is decided per file. */
  drillFiles: { filename: string; content: string | undefined }[];
  /** Layers whose role came from the file's own TF.FileFunction rather than its name. */
  declaredIdentityCount: number;
  warnings: ParserWarning[];
}

type BoundingBoxMm = { minX: number; maxX: number; minY: number; maxY: number };

function accumulateLayers(files: BundleFileEntry[]): LayerAccumulation {
  const layers: NormalizedLayer[] = [];
  const drillFiles: { filename: string; content: string | undefined }[] = [];
  const warnings: ParserWarning[] = [];
  let outline: LayerAccumulation["outline"];
  let copperLayerCount = 0;
  let declaredIdentityCount = 0;

  for (const entry of files) {
    const cleanName = entry.filename.replaceAll("\\", "/");
    const classification = classifyLayer(cleanName);
    if (!classification) continue;

    if (classification.role === "drill") {
      layers.push({ ...toLayer(classification, entry.filename) });
      // Plating is not decided here. `readDrillFiles` reads each file's own attributes and only
      // falls back to the name for the ones that stay silent.
      drillFiles.push({ filename: entry.filename, content: entry.content });
      continue;
    }

    // Where the artwork states what it is, that is what it is. The filename is the fallback.
    const parsed = entry.content ? parseGerber(entry.content, entry.filename) : undefined;
    warnings.push(...(parsed?.warnings ?? []));
    const declared = parsed?.identity;
    if (declared) declaredIdentityCount += 1;

    const role = declared?.role ?? classification.role;
    const resolved: LayerClassification = declared
      ? { name: nameForRole(role, declared.side, declared.index), role, side: declared.side, index: declared.index }
      : classification;

    if (declared && declared.role !== classification.role) {
      warnings.push({
        code: "LAYER_ROLE_FROM_CONTENT",
        message: `${entry.filename} declares TF.FileFunction "${parsed?.fileFunction}", which is a ${declared.role} layer, while its name suggests ${classification.role}. The file's own declaration is used.`,
        path: entry.filename,
      });
    }

    layers.push(toLayer(resolved, entry.filename));

    if (resolved.role === "copper") copperLayerCount++;
    if (resolved.role === "outline" && parsed) {
      outline = {
        boundingBoxMm: parsed.boundingBoxMm,
        closed: parsed.hasClosedContour,
        openContours: parsed.openContourCount,
      };
    }
  }

  return { layers, outline, copperLayerCount, drillFiles, declaredIdentityCount, warnings };
}

function toLayer(classification: LayerClassification, filename: string): NormalizedLayer {
  return {
    name: classification.name,
    role: classification.role,
    side: classification.side,
    index: classification.index,
    filename,
  };
}

/** A readable name for a role the file declared, matching the wording the filename path produces. */
function nameForRole(role: LayerRole, side: LayerSide, index: number | undefined): string {
  const position =
    side === "top" ? "Top" : side === "bottom" ? "Bottom" : side === "inner" ? `Inner ${index ?? ""}`.trim() : "";
  const label: Record<string, string> = {
    copper: "Copper",
    soldermask: "Solder Mask",
    silkscreen: "Silkscreen",
    solderpaste: "Paste",
    outline: "Board Outline",
    drill: "Drill",
  };
  const base = label[role] ?? role;
  return position ? `${position} ${base}` : base;
}

function buildStackupWarnings(hasAnyDrill: boolean, hasOutlines: boolean): ParserWarning[] {
  const warnings: ParserWarning[] = [];
  if (!hasAnyDrill) {
    warnings.push({
      code: "MISSING_DRILL",
      message: "No NC drill (.drl, .txt, .xln) files were detected in the package.",
    });
  }
  if (!hasOutlines) {
    warnings.push({
      code: "MISSING_OUTLINE",
      message: "No board outline (.gko, .gm1, Edge_Cuts) layer was detected in the package.",
    });
  }
  return warnings;
}

export function normalizeGerberStackup(files: BundleFileEntry[]): NormalizedStackupResult {
  const accumulated = accumulateLayers(files);
  const { layers, outline, copperLayerCount, drillFiles } = accumulated;
  const hasAnyDrill = layers.some((l) => l.role === "drill");
  const hasOutlines = layers.some((l) => l.role === "outline");
  const warnings = buildStackupWarnings(hasAnyDrill, hasOutlines);
  const drill = readDrillFiles(drillFiles);

  warnings.push(...accumulated.warnings, ...drill.warnings);

  // An outline whose contour never closes is the single most expensive thing in a fabrication
  // package to get wrong: the fabricator has no board shape. It was previously invisible here,
  // because nothing opened the file.
  if (outline && !outline.closed) {
    warnings.push({
      code: "OUTLINE_NOT_CLOSED",
      message:
        outline.openContours > 0
          ? `The board outline draws ${outline.openContours} contour(s) that never return to their start, so it does not describe a closed shape.`
          : "The board outline layer contains no closed contour, so it does not describe a board shape.",
    });
  }

  const box = outline?.boundingBoxMm;
  const board: NormalizedBoardMetadata = {
    name: "Board",
    layerCount: copperLayerCount > 0 ? copperLayerCount : undefined,
    ...(box && box.maxX > box.minX ? { widthMm: box.maxX - box.minX } : {}),
    ...(box && box.maxY > box.minY ? { heightMm: box.maxY - box.minY } : {}),
  };

  const capabilities: IngestionCapabilities = {
    hasGerberOutlines: hasOutlines,
    // Read from the drill files' own plating attributes where they declare them, and only from
    // the filename where they do not. The old rule was that any drill file at all
    // counts as plated holes", which is true often enough to look right and wrong exactly when it
    // matters: a bundle carrying only a non-plated set reported plated holes it does not have.
    hasPlatedHoles: drill.hasPlated,
    hasNonPlatedHoles: drill.hasNonPlated,
    hasBomMapping: false,
    hasCentroidPlacement: false,
    hasNetlistConnectivity: false,
    hasSchematicHierarchies: false,
  };

  return {
    board,
    layers,
    drillHoles: drill.holes,
    capabilities,
    warnings,
  };
}

type DrillReading = {
  holes: NormalizedDrillHole[];
  hasPlated: boolean;
  hasNonPlated: boolean;
  warnings: ParserWarning[];
};

/** What a filename alone suggests about plating, used only where the file itself is silent. */
function platingFromFilename(filename: string): "plated" | "non-plated" {
  return /-?NPTH/i.test(filename.replaceAll("\\", "/")) ? "non-plated" : "plated";
}

/**
 * Parses every drill file in the bundle and decides what the package actually contains.
 *
 * The decision is made **per file**, which is the part worth being careful about. An earlier
 * version computed the filename reading across the whole bundle and then OR-ed it with the
 * declarations, so a file that explicitly said `NonPlated` was overruled by its own unsuffixed
 * name -- the exact behaviour this change set out to remove, reintroduced one layer up. A file
 * that declares its plating decides for itself; only a silent one falls back to its name.
 */
function readDrillFiles(files: readonly { filename: string; content: string | undefined }[]): DrillReading {
  const holes: NormalizedDrillHole[] = [];
  const warnings: ParserWarning[] = [];
  let hasPlated = false;
  let hasNonPlated = false;
  let filesWithoutContent = 0;

  for (const file of files) {
    if (file.content === undefined) {
      filesWithoutContent += 1;
      if (platingFromFilename(file.filename) === "non-plated") hasNonPlated = true;
      else hasPlated = true;
      continue;
    }

    const parsed = parseExcellon(file.content, file.filename);
    holes.push(...parsed.holes);
    warnings.push(...parsed.warnings);

    if (parsed.platedEvidence === "declared") {
      for (const tool of parsed.tools) {
        if (tool.plated === true) hasPlated = true;
        if (tool.plated === false) hasNonPlated = true;
      }
      continue;
    }

    if (platingFromFilename(file.filename) === "non-plated") hasNonPlated = true;
    else hasPlated = true;
  }

  if (filesWithoutContent > 0) {
    warnings.push({
      code: "DRILL_CONTENT_UNAVAILABLE",
      message: `${filesWithoutContent} drill file(s) were listed without content, so their holes and plating could not be read. Anything said about them rests on the filename.`,
    });
  }

  return { holes, hasPlated, hasNonPlated, warnings };
}

interface LayerClassification {
  name: string;
  role: LayerRole;
  side: LayerSide;
  index?: number | undefined;
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
  const innerMatch = /\.g(\d+)$/u.exec(lower) ?? /[-_]in(\d+)_cu\.gbr$/u.exec(lower);
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
