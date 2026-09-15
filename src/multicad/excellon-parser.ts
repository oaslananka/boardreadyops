import type { NormalizedDrillHole, ParserWarning } from "@boardreadyops/contracts";

/**
 * Reads an Excellon drill file.
 *
 * Until now `drillHoles` was a hardcoded empty array and layers were classified by filename
 * extension alone, so a bundle whose files were *named* correctly passed whatever its contents
 * said. A stale drill export, a missing non-plated set, a file from the wrong commit -- all of it
 * went through. That is the class of error that costs a respin, and it is the one the gate claims
 * to catch.
 *
 * The parser's central obligation is therefore not coverage but honesty about its own footing.
 * Excellon is an old format with optional declarations: a file may state its coordinate format
 * and plating, or it may state neither and expect the reader to know. Where something is
 * declared, the result is exact and a rule may block a release on it. Where it is assumed, the
 * result is a guess with a plausible value, and a rule that blocks on a guess will eventually
 * block a good board -- after which the team switches the gate off and every other check in this
 * repository becomes worthless. So each assumption is recorded rather than folded into the
 * numbers. See issue #753.
 */

/**
 * Where a piece of information came from, which decides whether a rule may block on it.
 *
 * Not exported: nothing outside this module names it yet. A rule that needs to distinguish exact
 * from assumed evidence should export it at that point, rather than this module publishing a type
 * on the expectation of a caller that does not exist.
 */
type ExcellonEvidence = "declared" | "assumed";

type ExcellonCoordinateFormat = {
  integerDigits: number;
  decimalDigits: number;
  /**
   * Excellon's zero-suppression names are the opposite of what they sound like. `TZ` means
   * trailing zeros are *kept*, so leading ones are suppressed and a short coordinate pads on the
   * left. `LZ` means leading zeros are kept, so a short coordinate pads on the right. Reading
   * these backwards scales every coordinate by a power of ten, which is exactly the kind of
   * confidently wrong output this parser exists to avoid.
   */
  zeroSuppression: "leading-suppressed" | "trailing-suppressed";
  evidence: ExcellonEvidence;
};

type ExcellonTool = {
  code: string;
  diameterMm: number;
  /** Undefined when nothing in the file says, rather than defaulted to a guess. */
  plated: boolean | undefined;
};

export type ExcellonParseResult = {
  units: "mm" | "inch";
  unitsEvidence: ExcellonEvidence;
  format: ExcellonCoordinateFormat;
  /** Whether plating was stated anywhere, at file or tool level. */
  platedEvidence: ExcellonEvidence;
  tools: readonly ExcellonTool[];
  holes: readonly NormalizedDrillHole[];
  /** Slots collapse to their start point, because the contract holds one point per hole. */
  slotCount: number;
  warnings: readonly ParserWarning[];
};

/**
 * KiCad's metric default, and the most common metric output across tools. Used only when a file
 * declares no format, and always reported as assumed.
 */
const assumedMetricFormat = { integerDigits: 3, decimalDigits: 3 } as const;
/** The corresponding imperial default: 2 integer digits, 4 decimal. */
const assumedInchFormat = { integerDigits: 2, decimalDigits: 4 } as const;

const inchToMm = 25.4;

function warning(code: string, message: string, path?: string): ParserWarning {
  return path === undefined ? { code, message } : { code, message, path };
}

/** Strips the comment marker so attribute comments can be read as data. */
function attributeBody(line: string): string | undefined {
  // KiCad writes X2-style attributes inside comments: `; #@! TA.AperFunction,Plated,PTH,...`
  const match = /^;\s*#@!\s*(.+)$/u.exec(line.trim());
  return match?.[1]?.trim();
}

function platedFromAttribute(value: string): boolean | undefined {
  if (/(^|,)Plated(,|$)/u.test(value)) return true;
  if (/(^|,)NonPlated(,|$)/u.test(value)) return false;
  return undefined;
}

type HeaderState = {
  units: "mm" | "inch" | undefined;
  integerDigits: number | undefined;
  decimalDigits: number | undefined;
  zeroSuppression: "leading-suppressed" | "trailing-suppressed" | undefined;
  filePlated: boolean | undefined;
};

/**
 * Applies a coordinate format to a raw digit string.
 *
 * A coordinate that already carries a decimal point needs none of this and is taken at face
 * value, which is why tools that emit one are so much easier to trust.
 */
function coordinateValue(raw: string, format: ExcellonCoordinateFormat): number {
  const negative = raw.startsWith("-");
  const digits = raw.replace(/^[+-]/u, "");
  if (digits.includes(".")) {
    const parsed = Number.parseFloat(digits);
    return negative ? -parsed : parsed;
  }

  const total = format.integerDigits + format.decimalDigits;
  const padded =
    format.zeroSuppression === "leading-suppressed" ? digits.padStart(total, "0") : digits.padEnd(total, "0");
  const integerPart = padded.slice(0, format.integerDigits) || "0";
  const decimalPart = padded.slice(format.integerDigits);
  const parsed = Number.parseFloat(`${integerPart}.${decimalPart || "0"}`);
  return negative ? -parsed : parsed;
}

function parseHeaderLine(line: string, state: HeaderState, warnings: ParserWarning[], path?: string): void {
  const trimmed = line.trim();

  const attribute = attributeBody(trimmed);
  if (attribute) {
    if (attribute.startsWith("TF.FileFunction")) {
      const plated = platedFromAttribute(attribute);
      if (plated !== undefined) state.filePlated = plated;
    }
    return;
  }

  // Legacy plating comment, still emitted by some CAM tools.
  if (/^;\s*TYPE\s*=\s*PLATED/iu.test(trimmed)) {
    state.filePlated = true;
    return;
  }
  if (/^;\s*TYPE\s*=\s*NON_?PLATED/iu.test(trimmed)) {
    state.filePlated = false;
    return;
  }

  // `;FILE_FORMAT=3:3`
  const fileFormat = /^;\s*FILE_FORMAT\s*=\s*(\d+):(\d+)/iu.exec(trimmed);
  if (fileFormat?.[1] && fileFormat[2]) {
    state.integerDigits = Number.parseInt(fileFormat[1], 10);
    state.decimalDigits = Number.parseInt(fileFormat[2], 10);
    return;
  }

  // `METRIC`, `INCH`, optionally with `,TZ` / `,LZ` and an explicit `000.000` mask.
  const unitsMatch = /^(METRIC|INCH)((?:,[A-Z0-9.]+)*)/u.exec(trimmed);
  if (unitsMatch?.[1]) {
    state.units = unitsMatch[1] === "METRIC" ? "mm" : "inch";
    for (const modifier of (unitsMatch[2] ?? "").split(",").filter(Boolean)) {
      if (modifier === "TZ") state.zeroSuppression = "leading-suppressed";
      else if (modifier === "LZ") state.zeroSuppression = "trailing-suppressed";
      else {
        const mask = /^(0*)\.(0*)$/u.exec(modifier);
        if (mask?.[1] !== undefined && mask[2] !== undefined) {
          state.integerDigits = mask[1].length;
          state.decimalDigits = mask[2].length;
        } else if (modifier !== "000.000") {
          warnings.push(
            warning("excellon.unknown-unit-modifier", `Ignored an unrecognised unit modifier: ${modifier}.`, path),
          );
        }
      }
    }
  }
}

export function parseExcellon(content: string, path?: string): ExcellonParseResult {
  const warnings: ParserWarning[] = [];
  const state: HeaderState = {
    units: undefined,
    integerDigits: undefined,
    decimalDigits: undefined,
    zeroSuppression: undefined,
    filePlated: undefined,
  };

  const lines = content.split(/\r?\n/u);
  const toolsByCode = new Map<string, ExcellonTool>();
  const holes: NormalizedDrillHole[] = [];

  let inHeader = false;
  let bodyStarted = false;
  let pendingToolPlated: boolean | undefined;
  let currentTool: ExcellonTool | undefined;
  let slotCount = 0;
  // Resolved lazily: the header has to finish before a coordinate can be read, and the body may
  // start immediately after `%`.
  let format: ExcellonCoordinateFormat | undefined;

  function resolvedFormat(): ExcellonCoordinateFormat {
    if (format) return format;
    const units = state.units ?? "mm";
    const fallback = units === "inch" ? assumedInchFormat : assumedMetricFormat;
    const declared = state.integerDigits !== undefined && state.decimalDigits !== undefined;
    format = {
      integerDigits: state.integerDigits ?? fallback.integerDigits,
      decimalDigits: state.decimalDigits ?? fallback.decimalDigits,
      zeroSuppression: state.zeroSuppression ?? "leading-suppressed",
      evidence: declared ? "declared" : "assumed",
    };
    if (!declared) {
      warnings.push(
        warning(
          "excellon.assumed-coordinate-format",
          `No coordinate format declared; assumed ${format.integerDigits}.${format.decimalDigits} for ${units}. Coordinates from this file are an assumption, not a measurement.`,
          path,
        ),
      );
    }
    return format;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "M48") {
      inHeader = true;
      continue;
    }
    // `%` and `M95` both end the header.
    if (trimmed === "%" || trimmed === "M95") {
      inHeader = false;
      bodyStarted = true;
      continue;
    }
    if (trimmed === "M30" || trimmed === "M00") break;

    const attribute = attributeBody(trimmed);
    if (attribute?.startsWith("TA.AperFunction")) {
      // Applies to the tool defined on the following line.
      pendingToolPlated = platedFromAttribute(attribute);
      continue;
    }

    // `T01C0.400` -- a tool definition carries a diameter; a bare `T01` in the body selects one.
    const toolDefinition = /^T(\d+)C([\d.]+)/u.exec(trimmed);
    if (toolDefinition?.[1] && toolDefinition[2]) {
      const code = toolDefinition[1];
      const rawDiameter = Number.parseFloat(toolDefinition[2]);
      const diameterMm = (state.units ?? "mm") === "inch" ? rawDiameter * inchToMm : rawDiameter;
      if (!Number.isFinite(diameterMm) || diameterMm <= 0) {
        warnings.push(
          warning("excellon.invalid-tool-diameter", `Tool T${code} declares a diameter that is not usable.`, path),
        );
      } else {
        toolsByCode.set(code, { code, diameterMm, plated: pendingToolPlated ?? state.filePlated });
      }
      pendingToolPlated = undefined;
      continue;
    }

    if (inHeader && !bodyStarted) {
      parseHeaderLine(trimmed, state, warnings, path);
      continue;
    }

    const toolSelect = /^T(\d+)\s*$/u.exec(trimmed);
    if (toolSelect?.[1]) {
      currentTool = toolsByCode.get(toolSelect[1]);
      if (!currentTool) {
        warnings.push(
          warning(
            "excellon.undefined-tool",
            `The body selects tool T${toolSelect[1]}, which the header never defines. Its holes are not counted.`,
            path,
          ),
        );
      }
      continue;
    }

    const coordinate = /^(?:G0[05]\s*)?X([+-]?[\d.]+)Y([+-]?[\d.]+)(.*)$/u.exec(trimmed);
    if (!coordinate?.[1] || !coordinate[2]) continue;
    if (!currentTool) {
      warnings.push(warning("excellon.hole-before-tool", "A coordinate appears before any tool is selected.", path));
      continue;
    }

    const active = resolvedFormat();
    // A slot is `X..Y..G85X..Y..`: two endpoints for one cut. The contract holds a single point,
    // so the start is recorded and the collapse is counted rather than hidden.
    if (/G85/u.test(coordinate[3] ?? "")) slotCount += 1;

    holes.push({
      xMm: coordinateValue(coordinate[1], active) * (state.units === "inch" ? inchToMm : 1),
      yMm: coordinateValue(coordinate[2], active) * (state.units === "inch" ? inchToMm : 1),
      diameterMm: currentTool.diameterMm,
      plated: currentTool.plated ?? true,
    });
  }

  const tools = [...toolsByCode.values()];
  const platedDeclared = state.filePlated !== undefined || tools.some((tool) => tool.plated !== undefined);
  if (!platedDeclared && tools.length > 0) {
    warnings.push(
      warning(
        "excellon.assumed-plating",
        "Nothing in this file states whether its holes are plated; treated as plated. A rule must not block a release on this.",
        path,
      ),
    );
  }
  if (state.units === undefined) {
    warnings.push(warning("excellon.assumed-units", "No METRIC or INCH declaration; assumed millimetres.", path));
  }
  if (slotCount > 0) {
    warnings.push(
      warning(
        "excellon.slots-collapsed",
        `${slotCount} slot(s) recorded at their start point only; slot length is not represented.`,
        path,
      ),
    );
  }

  return {
    units: state.units ?? "mm",
    unitsEvidence: state.units === undefined ? "assumed" : "declared",
    format: resolvedFormat(),
    platedEvidence: platedDeclared ? "declared" : "assumed",
    tools,
    holes,
    slotCount,
    warnings,
  };
}
