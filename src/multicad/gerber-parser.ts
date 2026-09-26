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
 * says which of the two it got. Same split as the drill reader, same reason: a rule may block on a
 * release on what a file declares, never on what its name suggests. See issue #753.
 *
 * What the file says is read as a *stream*: `%...%` extended commands and the `*`-terminated word
 * commands between them, in the order the file wrote them, separated by the file's own delimiters.
 * The earlier version ran a handful of independent searches over the whole text instead, and a
 * search has no way to tell a G-code from a D-code that only looks like one, no way to tell a
 * `G04` comment from a `G40`, and -- worst of all -- no way to tell a command that was never
 * terminated from a command that runs to the end of the file. A stream can, and a parser that has
 * read a stream knows exactly which commands it did not read. That is what the rest of this module
 * is for; geometry semantics are a later step. See issues #855 and #858.
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
/**
 * Longest malformed-command excerpt a warning may quote.
 *
 * A command that was never terminated can be arbitrarily long -- a megabyte of paste in the wrong
 * place is still a command as far as the file is concerned -- and a warning has to be quotable in
 * a report, so the excerpt is cut here rather than allowed to grow with the input.
 */
const maxExcerptLength = 80;

/**
 * One command as the file wrote it, with its terminator removed.
 *
 * `unterminated` is not a command that happens to be malformed: it is the evidence that the file
 * has a command this parser did not read, which is a different thing from a command it read and
 * could not use.
 *
 * Not exported: nothing outside this module reads the stream, and a type published for a caller
 * that does not exist is the pattern #752 was written to stop.
 */
type GerberCommand =
  | { kind: "extended"; body: string }
  | { kind: "word"; body: string }
  | { kind: "unterminated"; shape: "extended" | "word"; body: string };

/** Where a command scan ended: at its terminator, or at the character where it gave up. */
type CommandEnd = { terminated: true; end: number } | { terminated: false; stoppedAt: number };

/**
 * How much of a file was not terminated, in a form a report can hold.
 *
 * Counted rather than listed: a file that is malformed throughout would otherwise produce a warning
 * per line, and the first excerpt already shows what went wrong.
 */
type UnterminatedEvidence = { count: number; excerpt: string | undefined };

/** Whitespace carries no meaning of its own; the next command starts after it. */
const whitespaceCharacters = new Set([" ", "\t", "\f", "\v", "\r", "\n"]);

/**
 * Line breaks, both flavours: a CAM tool on Windows writes `\r\n`, and one old enough to matter
 * writes `\r` alone. Either one ends a line, and a line is where a command must have ended.
 */
const lineBreakCharacters = new Set(["\r", "\n"]);

/**
 * Finds the `%` that closes an extended command, or the point where the file stopped looking like
 * one.
 *
 * An aperture macro is the only extended command whose body runs across line breaks. For anything
 * else a line break means the next `%` belongs to a later command, and adopting that one here
 * would splice two commands into a single malformed string and lose everything between them.
 */
function endOfExtendedCommand(content: string, start: number, spansLines: boolean): CommandEnd {
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content.charAt(index);
    if (char === "%") return { terminated: true, end: index };
    if (!spansLines && lineBreakCharacters.has(char)) return { terminated: false, stoppedAt: index };
  }
  // An aperture macro with no closing `%` reaches here. The walk resumes on the next line rather
  // than at the end of the file, so a macro that forgot its terminator cannot cost the artwork
  // that follows it.
  return { terminated: false, stoppedAt: nextLineBreak(content, start) };
}

/**
 * Finds the `*` that closes a word command, or the point where it cannot be one.
 *
 * Neither a line break nor a `%` can appear inside a word command, so a command that reaches one
 * was not terminated where the file appears to terminate it. Stopping there -- rather than taking
 * the next `*` from a following line -- is what keeps a missing `*` from merging two commands.
 */
function endOfWordCommand(content: string, start: number): CommandEnd {
  for (let index = start; index < content.length; index += 1) {
    const char = content.charAt(index);
    if (char === "*") return { terminated: true, end: index };
    if (char === "%" || lineBreakCharacters.has(char)) return { terminated: false, stoppedAt: index };
  }
  return { terminated: false, stoppedAt: content.length };
}

/** The next line break at or after `start`, or the end of the file when there is none. */
function nextLineBreak(content: string, start: number): number {
  for (let index = start; index < content.length; index += 1) {
    if (lineBreakCharacters.has(content.charAt(index))) return index;
  }
  return content.length;
}

/**
 * Splits a Gerber file into its commands, in source order.
 *
 * Extended commands come from `%` to `%`; everything else is a word command ending at the first
 * `*` on its line. A command that is never terminated yields evidence and the walk resumes at the
 * next line, so one missing delimiter costs that command and not the rest of the file.
 */
function tokenizeGerber(content: string): GerberCommand[] {
  const commands: GerberCommand[] = [];
  let index = 0;

  while (index < content.length) {
    while (index < content.length && whitespaceCharacters.has(content.charAt(index))) index += 1;
    if (index >= content.length) break;

    if (content.charAt(index) === "%") {
      // `%AMname*%` runs until the next `%`, which may be many lines below.
      const spansLines = /^[aA][mM]/u.test(content.slice(index + 1, index + 3));
      const end = endOfExtendedCommand(content, index, spansLines);
      if (end.terminated) {
        commands.push({ kind: "extended", body: content.slice(index + 1, end.end) });
        index = end.end + 1;
        continue;
      }
      commands.push({ kind: "unterminated", shape: "extended", body: content.slice(index, end.stoppedAt) });
      index = end.stoppedAt;
      continue;
    }

    const end = endOfWordCommand(content, index);
    if (end.terminated) {
      commands.push({ kind: "word", body: content.slice(index, end.end) });
      index = end.end + 1;
      continue;
    }
    commands.push({ kind: "unterminated", shape: "word", body: content.slice(index, end.stoppedAt) });
    index = end.stoppedAt;
  }

  return commands;
}

/**
 * Drops the whitespace inside a command.
 *
 * Whitespace between words inside a command is deprecated but legal, and where the file puts it is
 * not where the reader's attention is: `X10000000 Y0 D01*` and `X10000000Y0D01*` are one command.
 */
function compactCommand(body: string): string {
  return body.replace(/\s+/gu, "");
}

/**
 * The G-code a word command begins with, or undefined when it begins with something else.
 *
 * Read from the whole leading G word rather than from a prefix of it, so `G40` is a G40 and not a
 * `G4` with a stray zero, and `G04` is the comment that `G4` spells with a leading zero.
 */
function leadingGCode(command: string): number | undefined {
  const digits = /^G(\d+)/u.exec(command)?.[1];
  return digits === undefined ? undefined : Number.parseInt(digits, 10);
}

function boundedExcerpt(body: string): string {
  const text = body.replace(/\s+$/u, "");
  return text.length <= maxExcerptLength ? text : `${text.slice(0, maxExcerptLength)}...`;
}

function recordUnterminated(evidence: UnterminatedEvidence, body: string): void {
  if (evidence.count === 0) evidence.excerpt = boundedExcerpt(body);
  evidence.count += 1;
}

/** How many commands of each shape the file never terminated. */
type UnterminatedByShape = { extended: UnterminatedEvidence; word: UnterminatedEvidence };

/**
 * The evidence a malformed command stream leaves behind, at most one warning per shape however
 * much of the file is broken.
 */
function unterminatedWarnings(unterminated: UnterminatedByShape, path?: string): ParserWarning[] {
  const warnings: ParserWarning[] = [];
  const extended = unterminated.extended;
  if (extended.count > 0) {
    warnings.push(
      warning(
        "gerber.unterminated-extended-command",
        `An extended command is not closed by "%". There ${extended.count === 1 ? "is 1" : `are ${extended.count}`} of them, the first reading "${extended.excerpt}". The commands after it are still read, but this file's structure is not verified.`,
        path,
      ),
    );
  }
  const word = unterminated.word;
  if (word.count > 0) {
    warnings.push(
      warning(
        "gerber.unterminated-word-command",
        `A command is not terminated by "*". There ${word.count === 1 ? "is 1" : `are ${word.count}`} of them, the first reading "${word.excerpt}". The commands after it are still read, but this file's structure is not verified.`,
        path,
      ),
    );
  }
  return warnings;
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

/**
 * A word command that is entirely an operation, and nothing else: `X..Y..D0n*`, with either axis
 * optionally absent (it then keeps its previous value) and an optional leading interpolation code.
 *
 * Anchored on both ends because the stream has already decided where each command begins and ends.
 * An unanchored search finds an operation inside whatever text happens to surround it, which is how
 * a `D01` written in a comment or past the end of the file becomes a plotted point.
 */
const plottedOperation = /^(?:G\d+)?(?:X([+-]?\d+))?(?:Y([+-]?\d+))?(?:I[+-]?\d+)?(?:J[+-]?\d+)?D(0?[123])$/u;

function warning(code: string, message: string, path?: string): ParserWarning {
  return path === undefined ? { code, message } : { code, message, path };
}

/** The file's own `%FS%` declaration, before the result decides what to say about it. */
type DeclaredCoordinateFormat = {
  integerDigits: number;
  decimalDigits: number;
  zeroOmission: GerberCoordinateFormat["zeroOmission"];
  coordinateMode: "absolute" | "incremental";
};

/** Everything the file says about itself, read off its command stream in the order it wrote it. */
type GerberFileState = {
  /** From `%MO%` where the file declares it, and from the deprecated `G70`/`G71` where it does not. */
  units: "mm" | "inch" | undefined;
  format: DeclaredCoordinateFormat | undefined;
  /** From the deprecated `G90`/`G91`, read only where the file states no `%FS%` of its own. */
  legacyCoordinateMode: "absolute" | "incremental" | undefined;
  fileFunction: string | undefined;
  /** Whether a `G36` in file scope opens a region, whose contour is closed by definition. */
  regionInFileScope: boolean;
  /**
   * The file's own word commands, in source order and with their whitespace dropped: no comment,
   * no aperture-block body, and nothing from an `M02` onwards, because none of those is a command
   * of this file. The artwork is read from exactly this list.
   */
  wordCommands: readonly string[];
};

/**
 * The file-level state walk.
 *
 * An aperture block is the one place where a command is not in file scope: a macro body carries
 * codes that mean something else there -- a `D01` in it is a circle primitive, not a plotted point
 * -- so units, coordinate mode, region state and the end of the file are read only outside a block,
 * and a command that was never terminated is evidence rather than a command to interpret.
 */
type GerberFileStateAccumulator = {
  declaredUnits: "mm" | "inch" | undefined;
  legacyUnits: "mm" | "inch" | undefined;
  declaredFormat: DeclaredCoordinateFormat | undefined;
  legacyCoordinateMode: "absolute" | "incremental" | undefined;
  fileFunction: string | undefined;
  regionInFileScope: boolean;
  apertureBlockDepth: number;
  wordCommands: string[];
};

function snapshotFileState(state: GerberFileStateAccumulator): GerberFileState {
  return {
    units: state.declaredUnits ?? state.legacyUnits,
    format: state.declaredFormat,
    legacyCoordinateMode: state.legacyCoordinateMode,
    fileFunction: state.fileFunction,
    regionInFileScope: state.regionInFileScope,
    wordCommands: state.wordCommands,
  };
}

function applyExtendedFileStateCommand(
  command: Extract<GerberCommand, { kind: "extended" }>,
  state: GerberFileStateAccumulator,
): void {
  const compact = compactCommand(command.body);
  if (compact.startsWith("AM")) return;

  if (compact.startsWith("AB")) {
    if (compact === "AB*") state.apertureBlockDepth = Math.max(0, state.apertureBlockDepth - 1);
    else state.apertureBlockDepth += 1;
    return;
  }

  const unitsMatch = /^MO(MM|IN)\*$/u.exec(compact);
  if (unitsMatch) {
    state.declaredUnits ??= unitsMatch[1] === "IN" ? "inch" : "mm";
    return;
  }

  const formatMatch = /^FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*$/u.exec(compact);
  if (formatMatch) {
    state.declaredFormat ??= {
      integerDigits: Number.parseInt(formatMatch[3] ?? "3", 10),
      decimalDigits: Number.parseInt(formatMatch[4] ?? "5", 10),
      zeroOmission: formatMatch[1] === "T" ? "trailing" : "leading",
      coordinateMode: formatMatch[2] === "I" ? "incremental" : "absolute",
    };
    return;
  }

  if (state.fileFunction === undefined) {
    state.fileFunction = /^TF\.FileFunction,([^*]*)\*$/u.exec(command.body.trim())?.[1]?.trim();
  }
}

function applyWordFileStateCommand(
  command: Extract<GerberCommand, { kind: "word" }>,
  state: GerberFileStateAccumulator,
): boolean {
  const compact = compactCommand(command.body);
  const gCode = leadingGCode(compact);

  if (gCode === 4 || state.apertureBlockDepth > 0) return false;
  if (compact === "M02") return true;

  state.wordCommands.push(compact);
  if (gCode === 36) {
    state.regionInFileScope = true;
    return false;
  }

  if (gCode === 70) state.legacyUnits = "inch";
  else if (gCode === 71) state.legacyUnits = "mm";
  else if (gCode === 90) state.legacyCoordinateMode = "absolute";
  else if (gCode === 91) state.legacyCoordinateMode = "incremental";

  return false;
}

/**
 * The file-level state walk.
 *
 * Commands are consumed in source order. Extended and word command mutation lives in focused
 * helpers so this loop only owns command-kind dispatch, malformed-command evidence, and file end.
 */
function readFileState(commands: GerberCommand[], unterminated: UnterminatedByShape): GerberFileState {
  const state: GerberFileStateAccumulator = {
    declaredUnits: undefined,
    legacyUnits: undefined,
    declaredFormat: undefined,
    legacyCoordinateMode: undefined,
    fileFunction: undefined,
    regionInFileScope: false,
    apertureBlockDepth: 0,
    wordCommands: [],
  };

  for (const command of commands) {
    if (command.kind === "unterminated") {
      recordUnterminated(unterminated[command.shape], command.body);
    } else if (command.kind === "extended") {
      applyExtendedFileStateCommand(command, state);
    } else if (applyWordFileStateCommand(command, state)) {
      break;
    }
  }

  return snapshotFileState(state);
}

export function parseGerber(content: string, path?: string): GerberParseResult {
  const commands = tokenizeGerber(content);
  const unterminated: UnterminatedByShape = {
    extended: { count: 0, excerpt: undefined },
    word: { count: 0, excerpt: undefined },
  };
  const state = readFileState(commands, unterminated);

  const units = state.units;
  const declaredFormat = state.format;
  const format: GerberCoordinateFormat = declaredFormat
    ? {
        integerDigits: declaredFormat.integerDigits,
        decimalDigits: declaredFormat.decimalDigits,
        zeroOmission: declaredFormat.zeroOmission,
        evidence: "declared",
      }
    : { integerDigits: 3, decimalDigits: 5, zeroOmission: "leading", evidence: "assumed" };
  // A declared format states how the coordinates are meant; where the file states nothing at all,
  // a legacy G90/G91 is the only account of coordinate mode it gives.
  const incremental = (declaredFormat?.coordinateMode ?? state.legacyCoordinateMode) === "incremental";
  const identity = state.fileFunction ? identityFromFileFunction(state.fileFunction) : undefined;

  const warnings: ParserWarning[] = [];
  if (units === undefined) {
    warnings.push(warning("gerber.assumed-units", "No %MO% units declaration; assumed millimetres.", path));
  }
  if (!declaredFormat) {
    warnings.push(
      warning(
        "gerber.assumed-coordinate-format",
        "No %FS% format specification; assumed 3.5 with leading zeros omitted. Coordinates from this file are an assumption, not a measurement.",
        path,
      ),
    );
  }
  if (incremental) {
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
  if (state.fileFunction && !identity) {
    warnings.push(
      warning(
        "gerber.unmodelled-file-function",
        `The file declares TF.FileFunction "${state.fileFunction}", which is not a stackup layer; its role comes from the filename.`,
        path,
      ),
    );
  }
  warnings.push(...unterminatedWarnings(unterminated, path));

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
    /**
     * The second walk: the artwork, in the order it was drawn, over the commands that are in file
     * scope. Now that the stream has separated them, a `D10` in a comment payload, a `D36` that
     * opens nothing and a `G40` that is not a comment cannot turn into plotted geometry.
     */
    for (const command of state.wordCommands) {
      const operation = plottedOperation.exec(command);
      if (!operation) continue;
      const rawX = operation[1];
      const rawY = operation[2];
      // `D01`, `D02` and `D03` with or without a leading zero: draw, move, flash.
      const code = operation[3]?.replace(/^0/u, "");
      // A bare `D01*` moves nowhere; it is not a move to the current point.
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
    if (state.regionInFileScope) {
      inRegion = true;
      hasClosedContour = true;
    }
    finishContour();
  }

  return {
    units: units ?? "mm",
    unitsEvidence: units === undefined ? "assumed" : "declared",
    format,
    identity,
    fileFunction: state.fileFunction,
    boundingBoxMm: plotted >= 2 && Number.isFinite(minX) ? { minX, maxX, minY, maxY } : undefined,
    hasClosedContour,
    openContourCount,
    warnings,
  };
}
