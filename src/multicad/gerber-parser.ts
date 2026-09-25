import type { LayerRole, LayerSide, ParserWarning } from "@boardreadyops/contracts";

/**
 * Reads a Gerber file's own account of itself.
 *
 * Layers were classified by filename extension alone: `.gtl` meant top copper, `.gko` meant the
 * board outline, and nothing ever opened the file. So a bundle whose files were *named* correctly
 * passed regardless of what they contained -- a layer exported from the wrong commit, an outline
 * that is open in the artwork while closed in the source, a copper layer saved under a mask
 * layer's name. The filename is the one piece of a fabrication package that carries no authority
 * at all, and it was the only thing being read.
 *
 * Gerber X2 fixed this at the format level: `%TF.FileFunction,Copper,L1,Top*%` states what a file
 * is, inside the file. Where a file declares it, that is what the layer is. Where it does not --
 * plain RS-274X, which is still common -- the caller's filename reading stands, and the result
 * says which of the two it got. Same split as the drill reader, same reason: a rule may block a
 * release on what a file declares, never on what its name suggests. See issue #753.
 */

/**
 * Where a piece of information came from, which decides whether a rule may block on it.
 *
 * Exported because the normalizer now reports it per layer: a rule that has to decide whether a
 * layer is *absent* from a package cannot do that from a filename, and it cannot ask that question
 * of a value it is not allowed to name.
 */
export type GerberEvidence = "declared" | "assumed";

type GerberCoordinateFormat = {
  integerDigits: number;
  decimalDigits: number;
  /** `L` omits leading zeros, `T` omits trailing. Absolute vs incremental is tracked separately. */
  zeroOmission: "leading" | "trailing";
  evidence: GerberEvidence;
};

/**
 * Not exported: only `GerberParseResult` names it, and nothing outside this module does yet.
 * Publishing a type for a caller that does not exist is the pattern #752 was written to stop.
 */
type GerberLayerIdentity = {
  role: LayerRole;
  side: LayerSide;
  /** Copper layer ordinal from `Copper,L3,Inr`, when stated. */
  index: number | undefined;
};

export type GerberParseResult = {
  units: "mm" | "inch";
  unitsEvidence: GerberEvidence;
  format: GerberCoordinateFormat;
  /** Undefined when the file carries no `TF.FileFunction`, which is most pre-X2 output. */
  identity: GerberLayerIdentity | undefined;
  /** The raw attribute value, kept so a report can quote what the file actually said. */
  fileFunction: string | undefined;
  /** Bounding box of every plotted coordinate, in millimetres. Undefined when nothing was plotted. */
  boundingBoxMm: { minX: number; maxX: number; minY: number; maxY: number } | undefined;
  /**
   * Whether any drawn contour returns to where it started. Only meaningful on a profile layer,
   * where an open contour means the fabricator has no board shape.
   */
  hasClosedContour: boolean;
  /** Contours that were drawn but never closed, which is what makes an outline unusable. */
  openContourCount: number;
  warnings: readonly ParserWarning[];
};

const inchToMm = 25.4;
/** Two coordinates within this distance are the same point, in millimetres. */
const closureToleranceMm = 0.002;

function warning(code: string, message: string, path?: string): ParserWarning {
  return path === undefined ? { code, message } : { code, message, path };
}

/**
 * Maps a `TF.FileFunction` value onto the roles this codebase models.
 *
 * Returns undefined for functions with no place in the stackup -- drill maps, assembly drawings,
 * fabrication notes -- rather than forcing them into a role they do not have.
 */
function identityFromFileFunction(value: string): GerberLayerIdentity | undefined {
  const parts = value.split(",").map((part) => part.trim());
  const kind = parts[0]?.toLowerCase();

  if (kind === "copper") {
    // `Copper,L2,Inr` -- the ordinal is the reliable part; the position word can be absent.
    const ordinal = /^L(\d+)$/iu.exec(parts[1] ?? "")?.[1];
    const position = parts[2]?.toLowerCase();
    const side: LayerSide = position === "top" ? "top" : position === "bot" ? "bottom" : "inner";
    return { role: "copper", side, index: ordinal ? Number.parseInt(ordinal, 10) : undefined };
  }
  if (kind === "soldermask") {
    return { role: "soldermask", side: parts[1]?.toLowerCase() === "bot" ? "bottom" : "top", index: undefined };
  }
  if (kind === "legend") {
    return { role: "silkscreen", side: parts[1]?.toLowerCase() === "bot" ? "bottom" : "top", index: undefined };
  }
  if (kind === "paste") {
    return { role: "solderpaste", side: parts[1]?.toLowerCase() === "bot" ? "bottom" : "top", index: undefined };
  }
  if (kind === "profile") {
    return { role: "outline", side: "both", index: undefined };
  }
  return undefined;
}

function coordinateValue(raw: string, format: GerberCoordinateFormat): number {
  const negative = raw.startsWith("-");
  const digits = raw.replace(/^[+-]/u, "");
  const total = format.integerDigits + format.decimalDigits;
  const padded = format.zeroOmission === "leading" ? digits.padStart(total, "0") : digits.padEnd(total, "0");
  const value = Number.parseFloat(
    `${padded.slice(0, format.integerDigits) || "0"}.${padded.slice(format.integerDigits) || "0"}`,
  );
  return negative ? -value : value;
}

type Point = { x: number; y: number };

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= closureToleranceMm && Math.abs(a.y - b.y) <= closureToleranceMm;
}

export function parseGerber(content: string, path?: string): GerberParseResult {
  const warnings: ParserWarning[] = [];

  const unitsMatch = /%MO(MM|IN)\*%/u.exec(content);
  const units: "mm" | "inch" = unitsMatch?.[1] === "IN" ? "inch" : "mm";
  if (!unitsMatch) {
    warnings.push(warning("gerber.assumed-units", "No %MO% units declaration; assumed millimetres.", path));
  }

  // `%FSLAX35Y35*%` -- omission mode, coordinate mode, then digit counts per axis.
  const formatMatch = /%FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*%/u.exec(content);
  const format: GerberCoordinateFormat = formatMatch
    ? {
        integerDigits: Number.parseInt(formatMatch[3] ?? "3", 10),
        decimalDigits: Number.parseInt(formatMatch[4] ?? "5", 10),
        zeroOmission: formatMatch[1] === "T" ? "trailing" : "leading",
        evidence: "declared",
      }
    : { integerDigits: 3, decimalDigits: 5, zeroOmission: "leading", evidence: "assumed" };

  if (!formatMatch) {
    warnings.push(
      warning(
        "gerber.assumed-coordinate-format",
        "No %FS% format specification; assumed 3.5 with leading zeros omitted. Coordinates from this file are an assumption, not a measurement.",
        path,
      ),
    );
  } else if (formatMatch[2] === "I") {
    // Incremental coordinates are legal and vanishingly rare in modern output. Rather than
    // interpret them as absolute and produce a plausible, wrong bounding box, refuse the geometry.
    warnings.push(
      warning(
        "gerber.incremental-coordinates",
        "This file uses incremental coordinates, which are not interpreted; no geometry was read from it.",
        path,
      ),
    );
  }
  const incremental = formatMatch?.[2] === "I";

  const fileFunctionMatch = /%TF\.FileFunction,([^*]+)\*%/u.exec(content);
  const fileFunction = fileFunctionMatch?.[1]?.trim();
  const identity = fileFunction ? identityFromFileFunction(fileFunction) : undefined;
  if (fileFunction && !identity) {
    warnings.push(
      warning(
        "gerber.unmodelled-file-function",
        `The file declares TF.FileFunction "${fileFunction}", which is not a stackup layer; its role comes from the filename.`,
        path,
      ),
    );
  }

  const scale = units === "inch" ? inchToMm : 1;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let plotted = 0;
  let hasClosedContour = false;
  let openContourCount = 0;

  let current: Point | undefined;
  let contourStart: Point | undefined;
  let contourSegments = 0;
  // A region between G36 and G37 is closed by definition, so its contour never counts as open.
  let inRegion = false;

  function finishContour(): void {
    if (contourStart && current && contourSegments > 0) {
      if (inRegion || samePoint(contourStart, current)) hasClosedContour = true;
      else openContourCount += 1;
    }
    contourStart = undefined;
    contourSegments = 0;
  }

  if (!incremental) {
    // `X..Y..D0n*`, with either axis optionally absent (it then keeps its previous value).
    const operation = /(?:X([+-]?\d+))?(?:Y([+-]?\d+))?(?:I[+-]?\d+)?(?:J[+-]?\d+)?D(0?[123])\*/gu;
    for (const match of content.matchAll(operation)) {
      const rawX = match[1];
      const rawY = match[2];
      const code = match[3]?.replace(/^0/u, "");
      if (rawX === undefined && rawY === undefined) continue;

      const point: Point = {
        x: rawX !== undefined ? coordinateValue(rawX, format) * scale : (current?.x ?? 0),
        y: rawY !== undefined ? coordinateValue(rawY, format) * scale : (current?.y ?? 0),
      };

      if (code === "2") {
        // A move ends whatever contour was being drawn and starts a new one.
        finishContour();
        contourStart = point;
      } else if (code === "1") {
        if (!contourStart) contourStart = current ?? point;
        contourSegments += 1;
      }

      current = point;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      plotted += 1;
    }

    // Region state is applied after the sweep because G36/G37 interleave with operations; a file
    // containing any region has at least one closed contour by definition.
    if (/G36\*/u.test(content)) {
      inRegion = true;
      hasClosedContour = true;
    }
    finishContour();
  }

  return {
    units,
    unitsEvidence: unitsMatch ? "declared" : "assumed",
    format,
    identity,
    fileFunction,
    boundingBoxMm: plotted >= 2 && Number.isFinite(minX) ? { minX, maxX, minY, maxY } : undefined,
    hasClosedContour,
    openContourCount,
    warnings,
  };
}
