import type { ParserWarning } from "@boardreadyops/contracts";

/**
 * Aperture definitions, the aperture in force when something is plotted, and the scope each of them
 * belongs to.
 *
 * Three things about RS-274X apertures are easy to get subtly wrong, and each of them used to be
 * wrong here -- or, which is worse, absent:
 *
 * - **What a definition says.** `%ADD10C,0.1*%` is a circle of diameter 0.1 *in the file's own
 *   units*, so an inch file needs 25.4 times the number, and `0.1mm` is not 0.1. Reading the tail
 *   with `parseFloat`, which stops at the first character it cannot use, turns a broken dimension
 *   into a plausible one; a plausible one is what ends up printed on a report and believed. A
 *   number that is not exactly a Gerber number is refused, and a definition that cannot be read is
 *   evidence rather than a size.
 * - **Which scope a definition belongs to.** An `%AD` written between `%AB D12*%` and `%AB*%`
 *   belongs to that block and to nothing else. Letting it into file scope makes a D-code the file
 *   never defined look defined, which is the one false all-clear a gate must never give.
 * - **That a block is an aperture too.** `%AB D12*%` ... `%AB*%` defines aperture block 12, which
 *   is then selected with `D12*` and placed by a flash. Reading that selection as a reference to
 *   an undefined standard aperture reports a file as broken for using the block syntax as intended.
 *
 * And one thing is easy to get *plausibly* wrong, which is worse than getting it obviously wrong: a
 * hole is either a diameter or a reference to another aperture's hole, and the two are written the
 * same way. A hole code is therefore a reference only where the code is an aperture the file has
 * actually defined by the time it is needed; anywhere else the definition is refused, because a
 * number this reader cannot resolve must not be reported as a size.
 *
 * What a block contains is still not modelled, so a placement is reported as a placement and
 * nothing more: measuring placed geometry is #856, and the semantics this module holds are #859.
 */

/**
 * Gerber decimals are parsed by the linear scanner in readNumber rather than an ambiguity-heavy
 * regular expression. This keeps validation bounded for malformed, attacker-controlled input.
 */
/** A whole number with no sign and no decimal point, which is what a D-code and a vertex count are. */
const wholeNumber = /^\d+$/u;

/** `%ADD10C,0.1*%`, split into the D-code, the template letter, the rest of the template name, and the parameter tail. */
const apertureDefinitionCommand = /^ADD(\d+)([A-Za-z])([A-Za-z0-9_]*)(?:,([^*]*))?\*$/u;

/** The D-code of an `%AD` the parameter grammar did not match, so the warning can still name it. */
const apertureDefinitionPrefix = /^ADD(\d+)/u;

/** `%AB D12*%`, which is the only `%AB%` that opens a block by naming it. */
const apertureBlockOpenCommand = /^ABD(\d+)\*$/u;

/** A word command that is nothing but an aperture selection, with or without a leading G-code. */
const apertureSelection = /^(?:G\d+)?D(\d+)$/u;

/** The operation a word command ends with: `D03` is a flash, and the only operation that places a whole aperture. */
const flashOperation = /D0?3$/u;

/**
 * The lowest D-code that can name an aperture. 1 to 3 are the operation codes, so `D01*` is a draw
 * and not a selection of aperture 1, and a definition below this range cannot be selected at all.
 */
const firstApertureCode = 10;

/** How many aperture codes one message may quote before it counts the rest instead of listing them. */
const maxListedApertureCodes = 5;

/**
 * How many unreadable definitions one file may have reported one by one.
 *
 * A file that gets every `%AD%` wrong would otherwise produce a warning per D-code it has, which is
 * a list that grows with the input rather than a report of what is wrong with it.
 */
const maxDefinitionWarnings = 5;

/** A hole in the file's own units, as `%ADD10C,0.1X0.05*%` declares it. */
type ApertureHole = { kind: "diameter"; diameter: number };

/** The aperture table a definition is written into, which is also the table its references resolve in. */
/**
 * An aperture as the file defined it, with every number still in the file's own units.
 *
 * `unmodelled` is the honest answer for a definition whose numbers could not be read: the file did
 * assign that D-code an aperture, which is why the code counts as defined, but nothing about its
 * shape is claimed here.
 */
type ApertureDefinition =
  | { shape: "circle"; diameter: number; hole: ApertureHole | undefined }
  | { shape: "rectangle"; width: number; height: number; hole: ApertureHole | undefined }
  | { shape: "obround"; width: number; height: number; hole: ApertureHole | undefined }
  | {
      shape: "polygon";
      diameter: number;
      vertices: number;
      rotation: number | undefined;
      hole: ApertureHole | undefined;
    }
  | { shape: "macro"; macroName: string }
  | { shape: "block" }
  | { shape: "unmodelled" };

/** A hole in millimetres, or the D-code of another aperture whose hole it borrows. */
type GerberApertureHole = { kind: "diameter"; diameterMm: number };

/**
 * One aperture the file defined in file scope, with every dimension in millimetres.
 *
 * One entry per D-code, in the order the file declared them: this is a table of what the file says
 * its apertures are, not a list of the places it used them. A block-local definition is not here,
 * because it is not one of the file's apertures.
 */
export type GerberApertureDefinition =
  | { code: number; shape: "circle"; diameterMm: number; hole: GerberApertureHole | undefined }
  | { code: number; shape: "rectangle"; widthMm: number; heightMm: number; hole: GerberApertureHole | undefined }
  | { code: number; shape: "obround"; widthMm: number; heightMm: number; hole: GerberApertureHole | undefined }
  | {
      code: number;
      shape: "polygon";
      diameterMm: number;
      vertices: number;
      rotationDegrees: number | undefined;
      hole: GerberApertureHole | undefined;
    }
  | { code: number; shape: "macro"; macroName: string }
  | { code: number; shape: "block" }
  | { code: number; shape: "unmodelled" };

/**
 * A definition that was read as a definition but not as a shape.
 *
 * `malformed` is a definition the format does not allow, which is the file's problem. `unsupported`
 * is a definition the format allows that describes geometry this reader does not model, or geometry
 * that cannot exist; that is this reader's limit, and neither of them is a reason to print a size.
 *
 * Not exported: it names nothing outside this module, and a type published for a caller that does
 * not exist is the pattern #752 was written to stop.
 */
type ApertureProblem = {
  code: number;
  kind: "malformed" | "unsupported";
  /** One clause naming what the file wrote and what is wrong with it. */
  detail: string;
};

/**
 * A problem together with the scope whose definition caused it.
 *
 * `blockCode` on its own cannot say which scope: a block may be open without having named itself,
 * so `inBlock` is what separates a definition the file owns from one belonging to a block nobody
 * can name. Scope is part of the problem because the report names it: calling a block-local
 * definition one the file made is the same scope leak as treating the aperture itself as file scope.
 */
type ScopedApertureProblem = ApertureProblem & { inBlock: boolean; blockCode: number | undefined };

/** Either a value that could be read, or the evidence that it could not. */
type Reading<T> = { ok: true; value: T } | { ok: false; problem: ApertureProblem };

function successfulReading<T>(value: T): Reading<T> {
  return { ok: true, value };
}

function malformed<T>(code: number, detail: string): Reading<T> {
  return { ok: false, problem: { code, kind: "malformed", detail } };
}

function unsupported<T>(code: number, detail: string): Reading<T> {
  return { ok: false, problem: { code, kind: "unsupported", detail } };
}

/**
 * The aperture state a file accumulates as its commands are read.
 *
 * Two tables, because scope is the point of the exercise: `file` holds the apertures the file
 * defined in file scope, and `block` holds the table of the block currently open. A definition lands
 * in the table of whichever scope is open where it was written and in no other.
 */
export type ApertureLedger = {
  file: Map<number, ApertureDefinition>;
  /** The block being defined, with the aperture table that belongs to it alone. */
  block: { code: number | undefined; apertures: Map<number, ApertureDefinition>; selected: number | undefined } | undefined;
  /** The D-code the file has selected, which is what everything plotted after it is drawn with. */
  selected: number | undefined;
  /** Flashes performed with an aperture block selected, and the blocks they placed. */
  placements: { count: number; codes: number[] };
  /** D-codes selected in file scope that the file never defined there. */
  undefinedInFileScope: number[];
  /** D-codes a block used that the block never defined, and the block that wanted them. */
  undefinedInBlockScope: { blockCode: number | undefined; code: number }[];
  /** One entry per unreadable definition, keyed by the scope it was written in as well as its code. */
  problems: ScopedApertureProblem[];
};

export function createApertureLedger(): ApertureLedger {
  return {
    file: new Map(),
    block: undefined,
    selected: undefined,
    placements: { count: 0, codes: [] },
    undefinedInFileScope: [],
    undefinedInBlockScope: [],
    problems: [],
  };
}

/** Whether the walk is inside an aperture block, where a command means something else. */
export function isInsideApertureBlock(ledger: ApertureLedger): boolean {
  return ledger.block !== undefined;
}

/**
 * Applies one extended command, if it is an aperture definition or an aperture block boundary.
 *
 * Returns false for every other extended command, leaving the file-level parameters to the caller.
 * The distinction is not cosmetic: `%ADD%` inside a block defines that block's aperture and the same
 * command in file scope defines the file's.
 */
export function applyApertureExtended(ledger: ApertureLedger, compact: string): boolean {
  if (compact.startsWith("AD")) {
    defineAperture(ledger, compact);
    return true;
  }
  if (!compact.startsWith("AB")) return false;

  if (compact === "AB*") {
    closeApertureBlock(ledger);
    return true;
  }
  // `%AB D12*%` names the block being defined. An `%AB%` that names no block still opens one --
  // the file has left block scope and everything up to the matching `%AB*%` is block body -- but a
  // block nothing can select is never registered as an aperture.
  const code = apertureBlockOpenCommand.exec(compact)?.[1];
  ledger.block = {
    code: code === undefined ? undefined : Number.parseInt(code, 10),
    apertures: new Map(),
    selected: undefined,
  };
  return true;
}

/**
 * Applies one word command of file scope: a selection, or an operation drawn with what is selected.
 *
 * Block bodies do not come through here -- a `D01` in one is a circle primitive of a macro, not a
 * plotted point -- and neither do comments, which the caller drops first.
 */
export function applyApertureWord(ledger: ApertureLedger, compact: string): void {
  const selection = apertureSelection.exec(compact);
  if (selection?.[1] && Number.parseInt(selection[1], 10) >= firstApertureCode) {
    selectAperture(ledger, Number.parseInt(selection[1], 10));
    return;
  }
  // Only a flash puts a whole aperture onto the layer, so it is the only operation that can place
  // a block. A move and a draw leave the layer alone, and neither is geometry a block adds.
  if (flashOperation.test(compact)) noteFlash(ledger);
}

/**
 * Applies one standard Gerber word command inside an aperture block.
 *
 * An AB body is a normal Gerber command stream. A Dnn command (nn >= 10) selects the current
 * aperture for the block; D01/D02/D03 remain plot/move/flash operations. The block selection stays
 * in block scope so it cannot leak into the file-level graphics state after `%AB*%`.
 */
export function applyApertureBlockWord(ledger: ApertureLedger, compact: string): void {
  const selection = apertureSelection.exec(compact);
  if (selection?.[1] === undefined) return;

  const code = Number.parseInt(selection[1], 10);
  if (code < firstApertureCode) return;

  if (ledger.block !== undefined) ledger.block.selected = code;
  referenceBlockAperture(ledger, code);
}
/**
 * What the file's aperture state amounts to: the definitions it published, and its own evidence.
 *
 * Not exported for the same reason as `ApertureProblem`: the one caller destructures it rather than
 * naming it, and a caller that does not name a type does not need it published.
 */
type ApertureEvidence = {
  apertures: readonly GerberApertureDefinition[];
  warnings: readonly ParserWarning[];
};

/**
 * Closes the walk and reports what it found: the file's apertures in millimetres, and one warning
 * per distinct thing the file got wrong or this reader cannot follow.
 *
 * `scale` converts the file's own units to millimetres, so an inch file's 0.1 inch pad is 2.54 mm
 * rather than 0.1 mm. It is applied to every dimension, which is the only place in the parser where
 * a declared unit is applied to something that is not a coordinate.
 */
export function readApertureEvidence(ledger: ApertureLedger, scale: number, path?: string): ApertureEvidence {
  return {
    apertures: [...ledger.file].map(([code, definition]) => inMillimetres(code, definition, scale)),
    warnings: [
      ...definitionWarnings(ledger, path),
      ...undefinedApertureWarnings(ledger, path),
      ...placementWarnings(ledger, path),
    ],
  };
}

function defineAperture(ledger: ApertureLedger, compact: string): void {
  const scope = ledger.block?.apertures ?? ledger.file;
  const declared = apertureDefinitionCommand.exec(compact);
  if (!declared) {
    // The D-code is still readable even when the rest is not, and a definition that exists is not
    // the same thing as one that does not: the code counts as defined, with a warning attached.
    // Otherwise a file whose `%AD%` is malformed gets a second, false report saying it also failed
    // to define the aperture it selects. A code below the first selectable one is not registered,
    // because nothing can ever select it.
    const raw = apertureDefinitionPrefix.exec(compact)?.[1];
    if (raw !== undefined) {
      const code = Number.parseInt(raw, 10);
      recordProblem(ledger, {
        code,
        kind: "malformed",
        detail: `declares an aperture that cannot be read: "${compact}"`,
      });
      if (code >= firstApertureCode) scope.set(code, { shape: "unmodelled" });
    }
    return;
  }

  const code = Number.parseInt(declared[1] ?? "0", 10);
  if (code < firstApertureCode) {
    recordProblem(ledger, {
      code,
      kind: "malformed",
      detail: "is defined as a D-code below 10, which is an operation code rather than an aperture code",
    });
    return;
  }

  const reading = readApertureDefinition(
    code,
    declared[2] ?? "",
    declared[3] ?? "",
    declared[4],
  );
  if (!reading.ok) {
    recordProblem(ledger, reading.problem);
    scope.set(code, { shape: "unmodelled" });
    return;
  }
  scope.set(code, reading.value);
}

/**
 * Reads one `%AD%` definition.
 *
 * The templates are `C`, `R`, `O` and `P`; anything longer than one letter is the name of an
 * aperture macro, whose body is a statement list this reader does not model. The macro is recorded
 * as the aperture the file defined, because it is one, and its shape is left unclaimed.
 *
 */
function readApertureDefinition(
  code: number,
  template: string,
  name: string,
  tail: string | undefined,
): Reading<ApertureDefinition> {
  if (name !== "") return successfulReading({ shape: "macro", macroName: `${template}${name}` });
  if (tail === undefined) return malformed(code, "declares a shape with no parameters");

  const parts = tail.split("X");
  const shape = template.toUpperCase();
  if (shape === "C") return readCircle(code, parts);
  if (shape === "R") return readBox(code, parts, "rectangle");
  if (shape === "O") return readBox(code, parts, "obround");
  if (shape === "P") return readPolygon(code, parts);
  return unsupported(code, `declares the shape "${template}", which is not one this reader knows`);
}

function readCircle(code: number, parts: readonly string[]): Reading<ApertureDefinition> {
  if (parts.length > 2) return malformed(code, "gives a circle more than a diameter and a hole");
  const diameter = readSize(code, "circle diameter", parts[0]);
  if (!diameter.ok) return diameter;
  const hole = readHole(code, parts[1]);
  if (!hole.ok) return hole;
  const tooLarge = oversizedHole(diameter.value, hole.value);
  if (tooLarge !== undefined) {
    return unsupported(code, `puts a ${tooLarge} hole in a circle of ${diameter.value}`);
  }
  return successfulReading({ shape: "circle", diameter: diameter.value, hole: hole.value });
}

function readBox(
  code: number,
  parts: readonly string[],
  shape: "rectangle" | "obround",
): Reading<ApertureDefinition> {
  if (parts.length > 3) return malformed(code, `gives a ${shape} more than a width, a height and a hole`);
  const width = readSize(code, "width", parts[0]);
  if (!width.ok) return width;
  const height = readSize(code, "height", parts[1]);
  if (!height.ok) return height;
  const hole = readHole(code, parts[2]);
  if (!hole.ok) return hole;
  const tooLarge = oversizedHole(Math.min(width.value, height.value), hole.value);
  if (tooLarge !== undefined) {
    return unsupported(
      code,
      `puts a ${tooLarge} hole in a ${shape} of ${width.value}x${height.value}, which does not fit inside it`,
    );
  }
  return successfulReading({ shape, width: width.value, height: height.value, hole: hole.value });
}

/**
 * A polygon, whose parameters are the one place where the third number is not the hole: a diameter,
 * a vertex count, an optional rotation, and then an optional hole, in that order.
 */
function readPolygon(code: number, parts: readonly string[]): Reading<ApertureDefinition> {
  if (parts.length > 4) {
    return malformed(code, "gives a polygon more than a diameter, a vertex count, a rotation and a hole");
  }
  const diameter = readSize(code, "polygon diameter", parts[0]);
  if (!diameter.ok) return diameter;
  const vertices = readVertices(code, parts[1]);
  if (!vertices.ok) return vertices;
  const rotation = readRotation(code, parts[2]);
  if (!rotation.ok) return rotation;
  const hole = readHole(code, parts[3]);
  if (!hole.ok) return hole;
  const tooLarge = oversizedHole(diameter.value, hole.value);
  if (tooLarge !== undefined) {
    return unsupported(code, `puts a ${tooLarge} hole in a polygon of ${diameter.value}`);
  }
  return successfulReading({
    shape: "polygon",
    diameter: diameter.value,
    vertices: vertices.value,
    rotation: rotation.value,
    hole: hole.value,
  });
}

/**
 * A size the definition requires, read exactly or not at all.
 *
 * `label` is the bare noun the definition uses -- `width`, `height`, `circle diameter` -- because
 * the messages quote what the file wrote, and a message reading "gives no a height" is a second
 * thing to be embarrassed about on a report that exists to be read.
 */
function readSize(code: number, label: string, raw: string | undefined): Reading<number> {
  if (raw === undefined || raw === "") return malformed(code, `gives no ${label}`);
  const value = readNumber(raw);
  if (value === undefined) return malformed(code, `gives "${raw}" as ${label}, which is not a number`);
  if (value <= 0) return unsupported(code, `gives ${raw} as ${label}, which is not a size`);
  return successfulReading(value);
}

/**
 * The vertex count of a polygon, which has to be a whole number of at least three: fewer than three
 * vertices is not a polygon, and no reader can honestly report the shape the file asked for.
 */
function readVertices(code: number, raw: string | undefined): Reading<number> {
  if (raw === undefined || raw === "") return malformed(code, "gives no vertex count");
  if (!wholeNumber.test(raw)) return malformed(code, `gives "${raw}" as its vertex count, which is not a whole number`);
  const vertices = Number.parseInt(raw, 10);
  if (vertices < 3 || vertices > 12) {
    return unsupported(code, `gives a polygon of ${vertices} vertices; Gerber polygons require 3 to 12 vertices`);
  }
  return successfulReading(vertices);
}

function readRotation(code: number, raw: string | undefined): Reading<number | undefined> {
  if (raw === undefined) return successfulReading(undefined);
  const rotation = readNumber(raw);
  if (rotation === undefined) return malformed(code, `gives "${raw}" as its rotation, which is not an angle`);
  return successfulReading(rotation);
}

/**
 * The optional round-hole diameter of a standard aperture.
 *
 * Standard-aperture modifiers are literal decimal values. A whole number such as `14` is therefore
 * a 14-unit hole diameter even when aperture D14 exists; the modifier never dereferences D14.
 */
function readHole(code: number, raw: string | undefined): Reading<ApertureHole | undefined> {
  if (raw === undefined) return successfulReading(undefined);
  if (raw === "") return malformed(code, "gives an empty hole");

  const diameter = readNumber(raw);
  if (diameter === undefined) return malformed(code, `gives "${raw}" as its hole diameter, which is not a decimal`);
  if (diameter <= 0) return unsupported(code, `gives ${raw} as its hole diameter, which must be greater than zero`);
  return successfulReading({ kind: "diameter", diameter });
}
/** The hole diameter, when the hole is not smaller than the aperture it sits in. */
function oversizedHole(outer: number, hole: ApertureHole | undefined): number | undefined {
  return hole?.kind === "diameter" && hole.diameter >= outer ? hole.diameter : undefined;
}

/**
 * A number exactly as Gerber writes one, or undefined when the text is not one.
 *
 * Not `parseFloat`, which reads `0.1mm`, `0.1.2` and `1,0` as 0.1: that is how a malformed dimension
 * becomes a plausible one, and a plausible one is what gets printed.
 */
function readNumber(raw: string): number | undefined {
  if (raw === "") return undefined;

  let index = raw.startsWith("+") || raw.startsWith("-") ? 1 : 0;
  let digits = 0;
  let decimalPoints = 0;
  for (; index < raw.length; index += 1) {
    const char = raw.charCodeAt(index);
    if (char >= 48 && char <= 57) {
      digits += 1;
      continue;
    }
    if (char === 46 && decimalPoints === 0) {
      decimalPoints += 1;
      continue;
    }
    return undefined;
  }
  if (digits === 0) return undefined;

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function closeApertureBlock(ledger: ApertureLedger): void {
  const code = ledger.block?.code;
  ledger.block = undefined;
  // The block becomes an aperture of the file's own once it is closed, selected like any other with
  // `Dnn*` and placed by a flash. A block that was never opened closes nothing, and one whose code
  // is below the first selectable code names an operation rather than an aperture: registering it
  // would put a definition in the file's table that nothing in the file can ever select. That
  // `%AB D5*%` is a file-scope command is why this is reported as the file's own definition.
  if (code === undefined) return;
  if (code < firstApertureCode) {
    recordProblem(ledger, {
      code,
      kind: "malformed",
      detail:
        "is defined as an aperture block with a D-code below 10, which is an operation code rather than an aperture code",
    });
    return;
  }
  ledger.file.set(code, { shape: "block" });
}

function selectAperture(ledger: ApertureLedger, code: number): void {
  ledger.selected = code;
  if (!ledger.file.has(code) && !ledger.undefinedInFileScope.includes(code)) {
    ledger.undefinedInFileScope.push(code);
  }
}

function referenceBlockAperture(ledger: ApertureLedger, code: number): void {
  // A block may draw with an aperture the file defined before it was opened, and the format does not
  // say otherwise, so a code either scope defines is not evidence that the block body is broken.
  // Only a code neither of them has is what the block was reaching for and did not have.
  if (ledger.block?.apertures.has(code) === true || ledger.file.has(code)) return;
  const already = ledger.undefinedInBlockScope.some(
    (entry) => entry.code === code && entry.blockCode === ledger.block?.code,
  );
  if (!already) ledger.undefinedInBlockScope.push({ blockCode: ledger.block?.code, code });
}

function noteFlash(ledger: ApertureLedger): void {
  const selected = ledger.selected;
  if (selected === undefined || !ledger.file.has(selected)) return;
  if (ledger.file.get(selected)?.shape !== "block") return;
  ledger.placements.count += 1;
  if (!ledger.placements.codes.includes(selected)) ledger.placements.codes.push(selected);
}

function recordProblem(ledger: ApertureLedger, problem: ApertureProblem): void {
  const scoped: ScopedApertureProblem = {
    ...problem,
    inBlock: ledger.block !== undefined,
    blockCode: ledger.block?.code,
  };
  // One problem per D-code per scope: a definition that is wrong in the same way twice is one piece
  // of evidence, and a report is not the place for the file's every repetition of itself. Two scopes
  // breaking the same code are two mistakes by two different parts of the file, which is the same
  // distinction the undefined-aperture evidence is drawn on.
  const already = ledger.problems.some(
    (entry) => entry.code === scoped.code && entry.inBlock === scoped.inBlock && entry.blockCode === scoped.blockCode,
  );
  if (already) return;
  ledger.problems.push(scoped);
}

function inMillimetres(code: number, definition: ApertureDefinition, scale: number): GerberApertureDefinition {
  switch (definition.shape) {
    case "circle":
      return {
        code,
        shape: "circle",
        diameterMm: definition.diameter * scale,
        hole: holeInMillimetres(definition.hole, scale),
      };
    case "rectangle":
      return {
        code,
        shape: "rectangle",
        widthMm: definition.width * scale,
        heightMm: definition.height * scale,
        hole: holeInMillimetres(definition.hole, scale),
      };
    case "obround":
      return {
        code,
        shape: "obround",
        widthMm: definition.width * scale,
        heightMm: definition.height * scale,
        hole: holeInMillimetres(definition.hole, scale),
      };
    case "polygon":
      return {
        code,
        shape: "polygon",
        diameterMm: definition.diameter * scale,
        vertices: definition.vertices,
        rotationDegrees: definition.rotation,
        hole: holeInMillimetres(definition.hole, scale),
      };
    case "macro":
      return { code, shape: "macro", macroName: definition.macroName };
    case "block":
      return { code, shape: "block" };
    case "unmodelled":
      return { code, shape: "unmodelled" };
  }
}

function holeInMillimetres(hole: ApertureHole | undefined, scale: number): GerberApertureHole | undefined {
  return hole === undefined ? undefined : { kind: "diameter", diameterMm: hole.diameter * scale };
}

/**
 * One warning per definition this reader could not use, up to a bound, with the rest counted.
 *
 * The subject names the scope the definition was written in, because a block-local aperture is not
 * one of the file's, and a report calling it one is the same mistake as publishing it there. The
 * unsupported message then says where its numbers come from, because a size this parser refuses to
 * read is still the file's own size: quoting `0.2` as if it were millimetres would be the error
 * this whole module exists to avoid, one message later.
 */
function definitionWarnings(ledger: ApertureLedger, path?: string): ParserWarning[] {
  const shown = ledger.problems.slice(0, maxDefinitionWarnings);
  const warnings: ParserWarning[] = shown.map((problem) =>
    warning(
      problem.kind === "malformed" ? "gerber.malformed-aperture-definition" : "gerber.unsupported-aperture-definition",
      `${problemSubject(problem)}, but ${problem.detail}; ${
        problem.kind === "malformed"
          ? "nothing is read from that definition."
          : "its shape is not read from this file. The numbers are the file's own, in whatever units it declares."
      }`,
      path,
    ),
  );
  // A file with a broken `%AD%` in every code it has would otherwise produce one warning per code:
  // a list that grows with the file, on a report nobody reads to the end.
  const rest = ledger.problems.length - shown.length;
  if (rest > 0) {
    warnings.push(
      warning(
        "gerber.unreadable-aperture-definition",
        `There ${rest === 1 ? "is 1 further definition" : `are ${rest} further definitions`} this reader could not use, which ${rest === 1 ? "is" : "are"} not listed here.`,
        path,
      ),
    );
  }
  return warnings;
}

/** What wrote the definition, as a report has to name it. */
function problemSubject(problem: ScopedApertureProblem): string {
  if (!problem.inBlock) return `The file defines aperture D${problem.code}`;
  const block = problem.blockCode === undefined ? "An unnamed aperture block" : `Aperture block D${problem.blockCode}`;
  return `${block} defines aperture D${problem.code}`;
}

/**
 * One warning per scope that referenced an aperture the scope never defined.
 *
 * Scoped rather than pooled, and deduplicated within a scope: the same D-code being undefined in
 * file scope and inside a block are two different mistakes by two different pieces of the file, and
 * a single warning covering both would report a file as having one problem where it has two.
 */
function undefinedApertureWarnings(ledger: ApertureLedger, path?: string): ParserWarning[] {
  const warnings: ParserWarning[] = [];
  if (ledger.undefinedInFileScope.length > 0) {
    warnings.push(
      warning(
        "gerber.undefined-aperture",
        `The file selects ${listApertureCodes(ledger.undefinedInFileScope.map((code) => ({ code })))}, which it never defines; what is plotted with it cannot be read from this file.`,
        path,
      ),
    );
  }
  if (ledger.undefinedInBlockScope.length > 0) {
    warnings.push(
      warning(
        "gerber.undefined-aperture",
        `An aperture block uses ${listApertureCodes(
          ledger.undefinedInBlockScope.map((entry) => ({
            code: entry.code,
            qualifier: entry.blockCode === undefined ? undefined : `(in block D${entry.blockCode})`,
          })),
        )}, which the block never defines; what those blocks draw cannot be read from this file.`,
        path,
      ),
    );
  }
  return warnings;
}

/**
 * The evidence a block placement leaves.
 *
 * The block's own shape is not modelled, so a placement contributes its flash point and nothing
 * else: saying how much of the layer a placed block covers is exactly the measurement #856 will
 * make, and until then the honest report is that the geometry read from this file is incomplete.
 */
function placementWarnings(ledger: ApertureLedger, path?: string): ParserWarning[] {
  if (ledger.placements.count === 0) return [];
  const codes = listApertureCodes(ledger.placements.codes.map((code) => ({ code })));
  return [
    warning(
      "gerber.unmodelled-aperture-block",
      `Aperture block ${codes} is placed ${ledger.placements.count === 1 ? "once" : `${ledger.placements.count} times`}. A block's own shape is not modelled, so each placement contributes its flash point only and the geometry read from this file is incomplete.`,
      path,
    ),
  ];
}

/** Quotes at most a handful of codes and counts the rest, so one message cannot grow with the file. */
function listApertureCodes(codes: readonly { code: number; qualifier?: string | undefined }[]): string {
  const shown = codes
    .slice(0, maxListedApertureCodes)
    .map((entry) => (entry.qualifier === undefined ? `D${entry.code}` : `D${entry.code} ${entry.qualifier}`))
    .join(", ");
  const rest = codes.length - maxListedApertureCodes;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function warning(code: string, message: string, path?: string): ParserWarning {
  return path === undefined ? { code, message } : { code, message, path };
}
