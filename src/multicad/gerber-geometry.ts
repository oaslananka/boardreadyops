import type { GerberApertureDefinition } from "./gerber-apertures.js";

/**
 * Measurable geometry, and an explicit account of how much of it the artwork actually gave us.
 *
 * A Gerber file never says "a 10 mm trace 0.2 mm wide". It says `D10*` and then draws, and what lands
 * on the layer is whatever aperture 10 was, swept along the paths the file drew and flashed onto
 * them. Everything that wants to *measure* this artwork -- how far a pad is from the board edge,
 * whether a trace stays inside a keepout -- has to read three things at once: where the paths are,
 * what was swept along them, and how much of that the reader is sure of. This module holds the
 * first two, plus the third as a named reason rather than as a missing field, and nothing else.
 *
 * Three properties are load-bearing here, and each is a decision rather than an implementation
 * detail.
 *
 * **Bounded, always.** A `D01` or a `D03` is one line of a file this repository does not control,
 * and forty million of them must not decide how much memory a review holds. Collection stops at a
 * fixed primitive count and reports that it stopped.
 *
 * **Uncertain rather than exact.** A legal Gerber file can contain things this reader does not
 * model: aperture macros, aperture blocks, arcs, object transformations, step and repeat, copper
 * removed under a clear polarity, and a coordinate mode it refuses outright. Each of them marks the
 * geometry *incomplete* with the reason named. A geometry that says it does not know can be degraded
 * by whatever consumes it; a geometry that guesses and is believed is the one failure this whole
 * reader exists to prevent.
 *
 * **Aperture dimensions only where the aperture is faithful.** The four standard templates -- `C`,
 * `R`, `O` and `P` -- are declared and validated in `./gerber-apertures`, and they are the only
 * shapes whose copper is described here. Everything else contributes its position and no dimensions
 * at all. A hole modifier is a void *through* that copper rather than copper of its own, so that a
 * consumer measuring clearance to a pad measures the pad and not the hole it was drilled with.
 *
 * The collector is fed by `./gerber-parser` as the file's commands are walked rather than reading
 * the stream itself: the command walk a stream needs is the parser's, and a second walk over the
 * same command list with a second current point and a second region flag is one more thing that can
 * disagree with itself. What the parser passes is what the format means at that command; everything
 * this module decides -- what a draw is worth, what an aperture covers, when to stop -- is decided
 * here.
 */

/**
 * The file's own `%FS%` format specification: how many digits a coordinate word carries, and which
 * end of them the file leaves out.
 *
 * Which units those coordinates are in is a separate fact, applied separately: a 3.5 format is the
 * same arithmetic in a millimetre file and in an inch one.
 */
export type GerberFormatSpec = {
  integerDigits: number;
  decimalDigits: number;
  /** `L` omits leading zeros, `T` omits trailing. Absolute vs incremental is tracked separately. */
  zeroOmission: "leading" | "trailing";
};

/**
 * One coordinate word as the file's format states it, in the file's own units.
 *
 * Both walks of a file read coordinates, and they have to read them identically: a geometry
 * measured in one format against a bounding box measured in another is a measurement of nothing.
 * The declared format is what makes a coordinate mean anything at all, which is why the parser
 * publishes it beside every coordinate it publishes.
 */
export function readGerberCoordinate(raw: string, format: GerberFormatSpec): number {
  const negative = raw.startsWith("-");
  const digits = raw.replace(/^[+-]/u, "");
  const total = format.integerDigits + format.decimalDigits;
  const padded = format.zeroOmission === "leading" ? digits.padStart(total, "0") : digits.padEnd(total, "0");
  const value = Number.parseFloat(
    `${padded.slice(0, format.integerDigits) || "0"}.${padded.slice(format.integerDigits) || "0"}`,
  );
  return negative ? -value : value;
}

/**
 * A point in millimetres, in the artwork's own coordinate system.
 *
 * Not exported: every type below names it, `GerberGeometry` is what reaches a caller, and a caller
 * that reads points off a primitive does not need to name the type to read them.
 */
type GerberPoint = { readonly x: number; readonly y: number };

/**
 * An aperture whose copper this reader will describe, which is exactly the four standard templates.
 *
 * This is the subset of the definitions `./gerber-apertures` already validated, not a second
 * grammar: a macro or a block appears here as `undefined` on the flash that placed it, because its
 * parameters were never numbers this reader could check.
 *
 * `hole` is the void a `%ADD10C,1.0X0.5*%` opens in the middle of a 1.0 mm disc, and it is copper
 * that is *missing* rather than copper that is present. The outer dimensions are the extent; a
 * consumer that adds the hole to them has invented a pad the fabricator never cuts.
 */
type GerberModelledAperture = Extract<
  GerberApertureDefinition,
  { shape: "circle" | "rectangle" | "obround" | "polygon" }
>;

/**
 * A straight line the file drew, with the aperture that was in force when it drew it.
 *
 * The path is exact wherever the file drew one. The copper along it is not claimed unless
 * `widthMm` says so, and `widthMm` is claimed only for an aperture whose swept width is the same
 * whichever way the file was travelling: a circle. A rectangle, an obround or a polygon swept along
 * a path is as wide as its own cross-section, which depends on the direction of travel and on the
 * aperture's rotation, neither of which is modelled here. `undefined` therefore means "not claimed",
 * never "zero".
 *
 * Not exported for the same reason as `GerberPoint`: the two distance helpers below take one, and
 * a caller that holds a trace reads it off a `GerberGeometry`.
 */
type GerberTraceSegment = {
  readonly kind: "segment";
  readonly from: GerberPoint;
  readonly to: GerberPoint;
  /**
   * True when the file drew it between `G36` and `G37`, where a contour closes by statement.
   *
   * A region is a filled area, not a stroked path, and the format does not apply the selected
   * aperture to it: the copper inside the contour is the fill, and the contour is only its edge. So a
   * region edge is published with no `widthMm` and with no doubt about the aperture, and its
   * `apertureCode` names the D-code that happened to be selected -- not a stroke to measure with.
   * Reading that D-code's dimensions as the width of a region edge would measure copper the file
   * never asked for, and refusing the whole layer because CAM output left an arbitrary aperture
   * selected across a fill would refuse an ordinary zone for a reason the file never gave.
   */
  readonly inRegion: boolean;
  /** The D-code in force, which is what names the copper the path was drawn with. */
  readonly apertureCode: number | undefined;
  readonly widthMm: number | undefined;
};

/**
 * A whole aperture the file placed at a point.
 *
 * `aperture` is the copper it covers, in millimetres, and is undefined for every aperture this
 * reader cannot measure faithfully -- a macro, a block, a definition it could not read, or one the
 * file selected without ever defining. The flash is still real in all of those cases: its position
 * is on the layer, and its extent is not known here.
 *
 * It is also undefined for a flash `inRegion`, where there is no extent to know: a `D03` between
 * `G36` and `G37` is a degenerate contour the format collapses to the single point the file stated
 * and not a pad, so the aperture in force across the fill covers nothing. See the collector.
 */
type GerberFlash = {
  readonly kind: "flash";
  readonly at: GerberPoint;
  readonly inRegion: boolean;
  readonly apertureCode: number | undefined;
  readonly aperture: GerberModelledAperture | undefined;
};

/** One measurable thing the file drew, in the order it drew it. */
type GerberPrimitive = GerberTraceSegment | GerberFlash;

/**
 * Why the geometry is not everything the file draws.
 *
 * Every member names one thing a rule may act on and another may not: an incomplete geometry is a
 * true measurement of part of a layer, and a clearance rule that measures clearance from part of a
 * layer reports a clearance that was never measured.
 */
type GerberGeometryUncertainty =
  /** Collection stopped at its primitive budget, so the rest of the layer is not in the list. */
  | "primitive-limit"
  /** The file plots in incremental coordinates, which this reader refuses rather than misreads. */
  | "incremental-coordinates"
  /** Something was plotted with an aperture whose copper is not modelled: a macro, a block, or unreadable. */
  | "unsupported-aperture"
  /** Something was plotted with an aperture the file never defined, or with none selected at all. */
  | "undefined-aperture"
  /** An arc was drawn, and this reader measures straight traces only. */
  | "unsupported-interpolation"
  /** The file transformed the aperture it plots with, and no transformation is applied here. */
  | "object-transform"
  /** The file repeats what it draws with a step and repeat, and no repetition is applied here. */
  | "step-and-repeat"
  /**
   * The file plotted under `%LPC*%`, which removes copper rather than adding it.
   *
   * Nothing here composes a clear operation against the dark ones around it, so an object the file
   * erased is in the list and a fragment the file cut away of one is not: the geometry is a true
   * account of what was plotted and never of the copper that survived it.
   */
  | "clear-polarity";

/**
 * The geometry read from one file, together with what could not be read.
 *
 * `incomplete` is the field a consumer has to check before it may measure anything: it is true
 * exactly when `uncertainty` names at least one reason, so the two can never disagree.
 */
export type GerberGeometry = {
  readonly primitives: readonly GerberPrimitive[];
  readonly incomplete: boolean;
  /** Deduplicated, in the order the file first ran into each one, and never one per operation. */
  readonly uncertainty: readonly GerberGeometryUncertainty[];
};

/**
 * An object transformation the file states, which decides what it means for the geometry.
 *
 * Published as a kind rather than as a boolean so that a caller reading the file's state can say what
 * the file wrote, and so that this module can decide what that writing costs the measurement.
 */
export type GerberFileTransform = "mirror" | "rotation" | "scale" | "step-and-repeat";

/**
 * The three transformation families the spec defines, and step and repeat beside them.
 *
 * `%LMX*%` and `%LMY*%` mirror about one axis and `%LMXY*%` about both, with `%LMN*%` and a bare
 * `%LM*%` the spellings older files wrote; `%LR90*%` rotates and its `A`/`B`/`I`/`J`/`Q` modifiers say
 * which end of the axis the angle turns about; `%LSX2Y3*%` scales per axis and `%LS2*%` is the older
 * single-number spelling; and `%SRX2Y3I5.0J4.0*%` opens a step and repeat, which copies everything
 * drawn inside it, with `%SRX2Y3*%` and `%SR2*%` the older forms.
 *
 * Each match is anchored at both ends and after its family letters, and each body is spelled out
 * character by character rather than waved through, because `L` and `S` are not only transformation
 * families: `%LPD*%` and `%LPC*%` state a polarity, `%LN<name>*%` names a saved image and
 * `%LP<name>*%` selects it. A reader that took any `L*` or `S*` command for a transformation would
 * read all of those as a transform it had failed to apply, which is the false-uncertainty twin of
 * the false measurement this module exists to prevent: a report that refuses to act on a layer for a
 * reason the file never gave is a report nobody can act on at all.
 *
 * Each body is matched as the alphabet its parameters are written in -- an axis letter from that
 * family's own set, a sign, digits, decimal points -- and never as a structure of repeated numbers.
 * A structure of repeated `\d+` groups cannot be matched in time bounded by the length of what it
 * reads, because a run of digits splits between consecutive groups in as many ways as there are
 * digits, and a body that turns out not to match is where the engine walks every one of those ways:
 * `%LR` followed by sixty digits and no terminator is a statement a file this repository does not
 * control can write, and an exponential grammar spends the whole review on it.
 *
 * The alphabet is a decision rather than a shortcut. A body made of nothing but its own family's
 * parameter characters *is* that family stating the transformation, and a body that cannot be read
 * as one is a body whose decimal points and signs are in impossible places -- which is exactly the
 * malformed input this reader has to answer for, and the answer that fails in the safe direction.
 * Answering "no transformation" for one of those would report a layer as exactly measured on the
 * strength of a spelling that could not be parsed, and a confidently wrong measurement is read as a
 * measurement by whatever consumes it. That is why the structure a family's numbers have is read
 * where it decides something -- see `repeatsAnything` -- and only there.
 */
const mirrorTransform = /^LM[NXY]*\*$/u;
const rotationTransform = /^LR[ABIJQ+\-.0-9]*\*$/u;
const scaleTransform = /^LS[XY+\-.0-9]*\*$/u;

/**
 * The axis letters a step and repeat names its parameters with, which is what splits its body.
 *
 * `X` and `Y` count the copies on each axis and `I`/`J` offset them, and the pre-X2 `%SR2*%` states
 * one count for both directions without naming either. The letters are captured rather than dropped,
 * which is what leaves every value beside the axis it applies to: `X1Y1I0J0` splits into an empty
 * head, then `X`, `1`, `Y`, `1`, `I`, `0`, `J`, `0`, and a value the file wrote no axis for is left in
 * front of the list.
 */
const stepAndRepeatAxes = /([XYIJ])/u;

/**
 * A count that copies nothing, which is what a repetition with one copy on an axis states:
 * `%SRX1*%` and `%SRX1.0*%` both draw the artwork once.
 *
 * A count of zero is deliberately not in here, though no count is lower than it. Zero states that the
 * file plots no copy on that axis at all, so the `D01` and `D03` objects between the `%SR*%` and the
 * `%SR*%` that closes it are copper the file said it would not lay down. Reading those as the layer
 * would publish artwork that is not on it, and an absence published as a measurement is the one wrong
 * answer here that nothing downstream can flag, because every primitive collected really was plotted.
 */
const copiesAtMostOnce = /^1(?:\.0+)?$/u;

/**
 * An offset that copies nothing, and only a literal zero is one. `%SRI1*%` still copies: it draws a
 * second layer of artwork displaced by one unit, which is a panel rather than an identity. The sign
 * the spec lets an offset carry is read and discarded here, because a signed zero displaces nothing.
 */
const copiesWithoutOffset = /^[+-]?0(?:\.0+)?$/u;

/**
 * Any file-scope statement of a step and repeat, however it is spelled.
 *
 * Anchored at both ends and matched before the grammar above, because the answer to "does this repeat
 * anything" has two very different ways to be wrong. Reading an unreadable repetition as no
 * repetition at all would report a file that copies its artwork across a panel as exactly measured,
 * which is the failure this module exists to prevent; it is the one case here that fails closed.
 */
const stepAndRepeatStatement = /^SR[^*]*\*$/u;

/** What each transformation costs the geometry, which is the same for all of them but one. */
const transformUncertainty: Record<GerberFileTransform, GerberGeometryUncertainty> = {
  mirror: "object-transform",
  rotation: "object-transform",
  scale: "object-transform",
  "step-and-repeat": "step-and-repeat",
};

/**
 * Whether a numeric transform is one of the standard identity/reset values.
 *
 * The family recognizers deliberately remain fail-closed for malformed bodies. Only a body that
 * JavaScript can read as one finite number may be treated as an identity, so inputs such as
 * `LR1.2.3*` stay uncertain instead of being mistaken for a harmless reset.
 */
function numericTransformIsIdentity(compact: string, prefix: "LR" | "LS", identity: number): boolean {
  const body = compact.slice(prefix.length, -1);
  if (body === "") return false;
  const value = Number(body);
  return Number.isFinite(value) && value === identity;
}

/**
 * The non-identity transformation a file-scope extended command states, or undefined when it states
 * no transformation that changes geometry.
 *
 * Gerber's explicit graphics-state identities are `LMN` (no mirroring), `LR0` (zero rotation), and
 * `LS1` (unity scale). They reset state rather than changing geometry, so reporting them as
 * unapplied transforms would turn an exactly measurable layer into a false uncertainty. Malformed or
 * unsupported transform-family statements still fail closed, and step-and-repeat keeps its separate
 * identity handling in `repeatsAnything`.
 */
export function readGerberTransform(compact: string): GerberFileTransform | undefined {
  if (compact === "LMN*") return undefined;
  if (mirrorTransform.test(compact)) return "mirror";
  if (rotationTransform.test(compact)) {
    return numericTransformIsIdentity(compact, "LR", 0) ? undefined : "rotation";
  }
  if (stepAndRepeatStatement.test(compact)) return repeatsAnything(compact) ? "step-and-repeat" : undefined;
  if (scaleTransform.test(compact)) {
    return numericTransformIsIdentity(compact, "LS", 1) ? undefined : "scale";
  }
  return undefined;
}

/**
 * Whether a step and repeat has anything to repeat.
 *
 * Two spellings reach here and both have to be answered the same way. A command this reader cannot
 * read is a repetition this reader did not apply, so it counts: reading `%SRX2*%` as no repetition
 * at all would publish a panel's untransformed artwork as though the file had drawn it once. A
 * command that states one copy in each direction with no offset copies nothing: `%SRX1Y1I0J0*%` is
 * what ordinary CAM output writes on every layer it exports, and reading it as a transformation
 * would mark every honest board incomplete for a repetition that was never going to happen.
 *
 * So each value is read against the one thing it is able to say -- a count of exactly one, an offset
 * of zero -- and anything else counts as a repetition: a count of two, a count of zero, an offset of
 * one, a value that is not a number at all, and a bare axis letter with no value behind it.
 */
function repeatsAnything(compact: string): boolean {
  // `stepAndRepeatStatement` has already established that this is a step-and-repeat statement, so
  // the body is whatever the file wrote between the `SR` and the `*`. Splitting leaves what came
  // before the first axis letter in front of the list -- empty when the file opened with one, and
  // the pre-X2 `%SR2*%`'s count when it did not.
  const [head, ...labelled] = compact.slice(2, -1).split(stepAndRepeatAxes);
  const unlabelled = head ?? "";

  // A value with no axis in front of it is a count rather than an offset: `%SR2*%` states one count
  // for both directions, and a count this cannot answer is a repetition it did not apply.
  if (unlabelled !== "" && !copiesAtMostOnce.test(unlabelled)) return true;

  for (let index = 0; index < labelled.length; index += 2) {
    const axis = labelled[index];
    const value = labelled[index + 1];
    if (axis === undefined || value === undefined) return true;
    const statesIdentity = axis === "I" || axis === "J" ? copiesWithoutOffset : copiesAtMostOnce;
    if (!statesIdentity.test(value)) return true;
  }
  return false;
}

/**
 * The most primitives one file may contribute to the geometry evidence.
 *
 * Primitive count is a fixed number rather than a byte measure so that the same file always yields
 * the same geometry: a budget that depended on how much memory happened to be free would make the
 * evidence a property of the machine rather than of the artwork.
 *
 * A file that reaches it keeps the primitives it plotted first and is then reported incomplete with
 * `primitive-limit`. Truncation is not the alternative to a budget -- a collector that holds every
 * `D01` and `D03` in a package is a memory ceiling set by whoever exported the package. A truncated
 * geometry that names the truncation is one a rule can refuse; a truncated geometry that does not is
 * a partial layer measured as though it were the whole of it.
 */
const maxGeometryPrimitives = 25_000;

/** What the file's aperture table says about the aperture in force, resolved for measurement. */
type ResolvedAperture =
  | { kind: "modelled"; aperture: GerberModelledAperture }
  | { kind: "unsupported" }
  | { kind: "undefined" };

/** Everything the collector needs to know about the file before its first command is read. */
type GerberGeometryInput = {
  /**
   * The file's own aperture definitions, in millimetres, as `./gerber-apertures` read them.
   *
   * The definitions arrive already converted because the parser converted them for its own reasons
   * and converting them twice would let the two walks disagree about the only scale a file has.
   */
  apertures: readonly GerberApertureDefinition[];
  /** Whether the file plots incrementally, which this reader refuses rather than misreads. */
  incremental: boolean;
  /**
   * Whether the file plotted anything under `%LPC*%`, which removes copper rather than adding it.
   *
   * A fact about the file rather than about a particular object, so it is taken once here: composing
   * a clear operation against the dark ones around it is not something the collector can do, and a
   * file that erases copper anywhere on the layer has a layer whose copper the list below is not an
   * account of.
   */
  clearPolarity: boolean;
  /** The object transformations the file states, deduplicated by the caller. */
  transforms: readonly GerberFileTransform[];
};

/**
 * Where measurable geometry accumulates, one plotted object at a time.
 *
 * The parser decides what a command means in the stream; the collector decides what that is worth as
 * a measurement, what it is worth when the aperture in force cannot be measured, and when there has
 * been enough of it.
 */
export type GerberGeometryCollector = {
  /**
   * Records a straight line the file drew between two points it stated in millimetres.
   *
   * A line whose ends coincide is recorded as it stands: it is a point the file plotted, and the
   * distance helpers treat it as the degenerate segment it is rather than dividing by its own
   * length.
   */
  segment(from: GerberPoint, to: GerberPoint, context: { inRegion: boolean; apertureCode: number | undefined }): void;
  /** Records a whole aperture the file placed, with its copper where the aperture can be measured. */
  flash(at: GerberPoint, context: { inRegion: boolean; apertureCode: number | undefined }): void;
  /**
   * Records something the file plotted or placed that this reader did not put into the list.
   *
   * One entry per kind of thing rather than one per operation, so a layer with ten thousand macros
   * on it produces the same single reason as a layer with one.
   */
  uncertain(reason: GerberGeometryUncertainty): void;
  /** Closes the collection and returns what it holds, frozen. Safe to call more than once. */
  evidence(): GerberGeometry;
};

/**
 * Starts collecting the geometry of one file.
 *
 * The aperture table is indexed once here rather than searched per plotted object: a dense layer
 * plots far more objects than it defines apertures, and a linear search per object would make the
 * cost of a file quadratic in its own size.
 */
export function createGerberGeometryCollector(input: GerberGeometryInput): GerberGeometryCollector {
  const apertures = new Map(input.apertures.map((aperture) => [aperture.code, aperture]));
  const primitives: GerberPrimitive[] = [];
  const uncertainty = new Set<GerberGeometryUncertainty>();

  if (input.incremental) uncertainty.add("incremental-coordinates");
  if (input.clearPolarity) uncertainty.add("clear-polarity");
  for (const transform of input.transforms) uncertainty.add(transformUncertainty[transform]);

  /**
   * The aperture a plotted object was drawn with, in the terms measurement needs.
   *
   * The file's own table decides all three cases, and the difference between them matters: an
   * aperture that is not there and an aperture whose shape is not modelled both leave the object's
   * extent unclaimed, and a rule has to be able to tell "the file drew with something I cannot
   * measure" from "the file drew with something it never defined", because only the second is
   * evidence about the file rather than about this reader.
   */
  function resolve(code: number | undefined): ResolvedAperture {
    if (code === undefined) return { kind: "undefined" };
    const definition = apertures.get(code);
    if (definition === undefined) return { kind: "undefined" };
    return isModelled(definition) ? { kind: "modelled", aperture: definition } : { kind: "unsupported" };
  }

  /**
   * Whether one more primitive may be recorded.
   *
   * Once the budget is reached the reason is recorded and every later object is dropped, which is
   * what keeps the list bounded: the collection is a `Set` of reasons, not a list per operation, and
   * the walk that feeds it still runs to the end of the file so that everything else the file says
   * about itself is unaffected by where the geometry stopped.
   */
  function reserve(): boolean {
    if (primitives.length < maxGeometryPrimitives) return true;
    uncertainty.add("primitive-limit");
    return false;
  }

  /**
   * Records what the aperture a plotted object was drawn with makes doubtful, if anything.
   *
   * Called before the budget is asked whether one more primitive fits, and deliberately in that
   * order: whether the file drew with an aperture this reader cannot measure is a fact about the
   * file, and it holds for the objects the budget dropped as much as for the ones it kept.
   */
  function recordApertureUncertainty(resolved: ResolvedAperture): void {
    if (resolved.kind === "unsupported") uncertainty.add("unsupported-aperture");
    if (resolved.kind === "undefined") uncertainty.add("undefined-aperture");
  }

  return {
    segment(from, to, context) {
      // A region contour is a filled area's edge rather than a stroked path, and the format does not
      // apply the aperture in force to a region, so it is neither measured from that aperture nor
      // doubted because of it: CAM output that leaves an arbitrary aperture selected across a fill
      // does not make the zone under it unmeasurable.
      const resolved = context.inRegion ? undefined : resolve(context.apertureCode);
      if (resolved !== undefined) recordApertureUncertainty(resolved);
      if (!reserve()) return;
      primitives.push(
        Object.freeze({
          kind: "segment",
          from: frozenPoint(from),
          to: frozenPoint(to),
          inRegion: context.inRegion,
          apertureCode: context.apertureCode,
          widthMm: resolved?.kind === "modelled" ? sweptWidthMm(resolved.aperture) : undefined,
        }),
      );
    },

    flash(at, context) {
      // A flash inside a region is a degenerate contour rather than a pad: the format collapses it to
      // the single point the file stated and ends the contour there, and the aperture in force across
      // the fill has no copper to cover. Claiming that aperture's dimensions would publish a disc of
      // copper the file never laid down, and doubting the aperture would refuse an ordinary region
      // for a reason the file never gave -- the same two mistakes a region edge would make, and
      // answered the same way a region edge is.
      const resolved = context.inRegion ? undefined : resolve(context.apertureCode);
      if (resolved !== undefined) recordApertureUncertainty(resolved);
      if (!reserve()) return;
      primitives.push(
        Object.freeze({
          kind: "flash",
          at: frozenPoint(at),
          inRegion: context.inRegion,
          apertureCode: context.apertureCode,
          aperture: resolved?.kind === "modelled" ? frozenAperture(resolved.aperture) : undefined,
        }),
      );
    },

    uncertain(reason) {
      uncertainty.add(reason);
    },

    evidence() {
      const reasons = Object.freeze([...uncertainty]);
      return Object.freeze({
        primitives: Object.freeze(primitives.slice()),
        incomplete: reasons.length > 0,
        uncertainty: reasons,
      });
    },
  };
}

/** Whether a definition is one of the four standard templates, which is the only copper claimed here. */
function isModelled(definition: GerberApertureDefinition): definition is GerberModelledAperture {
  return (
    definition.shape === "circle" ||
    definition.shape === "rectangle" ||
    definition.shape === "obround" ||
    definition.shape === "polygon"
  );
}

/**
 * A copy of a definition, frozen.
 *
 * The file's aperture table is shared with everything else the parser publishes, and a consumer that
 * could reach through a flash into that table and widen a pad would be editing the file's own
 * account of itself. The hole is copied with it for the same reason: it is the void inside the
 * copper, and a writable one is a way to turn a drilled pad back into solid copper.
 *
 * The copy is complete rather than best-effort because the four modelled templates are a closed set
 * of numbers plus `hole`, and `hole` is itself a flat pair. Anything that made one of them nest
 * again would have to be copied here, which is the one place to look when that happens.
 */
function frozenAperture(aperture: GerberModelledAperture): GerberModelledAperture {
  return Object.freeze({
    ...aperture,
    hole: aperture.hole === undefined ? undefined : Object.freeze({ ...aperture.hole }),
  });
}

function frozenPoint(point: GerberPoint): GerberPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

/**
 * How wide the copper a path is drawn with, where that is the same in every direction.
 *
 * Only a circle gets an answer. The other three standard templates are swept along the path with
 * their own cross-section facing across it, and which of their two dimensions does that depends on
 * the direction of travel and on the aperture's rotation -- neither of which is modelled here, so
 * none of them publishes a width a clearance rule could measure with.
 */
function sweptWidthMm(aperture: GerberModelledAperture): number | undefined {
  return aperture.shape === "circle" ? aperture.diameterMm : undefined;
}

function distanceMm(a: GerberPoint, b: GerberPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * How far a point is from the straight line a trace was drawn along.
 *
 * A segment whose ends coincide has no direction to project onto, so the closest point on it is the
 * point itself -- a `D01` that lands where it started is a point on the layer, and treating it as a
 * line of zero length would make this helper divide by zero on exactly the input a malformed file
 * is most likely to contain.
 */
export function pointToSegmentDistanceMm(point: GerberPoint, segment: GerberTraceSegment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceMm(point, segment.from);

  const along = ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) / lengthSquared;
  // Clamped into the path's own extent, because the nearest point on a path is inside it: a
  // projection past either end has to land on that end rather than beyond it.
  const fraction = Math.min(1, Math.max(0, along));
  return distanceMm(point, { x: segment.from.x + fraction * dx, y: segment.from.y + fraction * dy });
}

/**
 * How far apart two drawn paths are, which is the question a clearance check actually asks.
 *
 * The minimum distance between two segments that do not meet is always attained at an endpoint of at
 * least one of them, so the four endpoint-to-segment distances are the whole of the answer once
 * crossing has been ruled out. Meeting is checked first and exactly: a test that reports two
 * near-touching paths as separated can only overstate a clearance, and one that reports separated
 * paths as touching can only understate it, so the crossing test is written to claim intersection
 * only where the arithmetic is a zero rather than a tolerance.
 */
export function segmentToSegmentDistanceMm(first: GerberTraceSegment, second: GerberTraceSegment): number {
  if (crosses(first, second)) return 0;
  return Math.min(
    pointToSegmentDistanceMm(first.from, second),
    pointToSegmentDistanceMm(first.to, second),
    pointToSegmentDistanceMm(second.from, first),
    pointToSegmentDistanceMm(second.to, first),
  );
}

/** Whether a path has no direction at all, so that no orientation test can mean anything by it. */
function isDegenerate(segment: GerberTraceSegment): boolean {
  return segment.from.x === segment.to.x && segment.from.y === segment.to.y;
}

/**
 * Twice the signed area of the triangle three points make, which is zero exactly when they are
 * collinear. Signed rather than absolute so that which side of the line a point falls on is
 * readable, and integer-valued for the whole-number coordinates most artwork is written in.
 */
function orientation(a: GerberPoint, b: GerberPoint, c: GerberPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether a collinear point lies between the two ends that define the line. */
function isBetween(start: GerberPoint, end: GerberPoint, point: GerberPoint): boolean {
  return (
    Math.min(start.x, end.x) <= point.x &&
    point.x <= Math.max(start.x, end.x) &&
    Math.min(start.y, end.y) <= point.y &&
    point.y <= Math.max(start.y, end.y)
  );
}

/**
 * Whether two paths meet, whether they cross, touch at an end, or lie on top of each other.
 *
 * Collinear overlap is a meeting: two paths drawn along the same line share every point between
 * them, and reporting a positive distance between them would report a gap in copper that is not
 * there. A degenerate path is excluded because orientation is zero for every point against a
 * zero-length path, which would make any point "touch" it.
 */
function crosses(first: GerberTraceSegment, second: GerberTraceSegment): boolean {
  if (isDegenerate(first) || isDegenerate(second)) return false;

  const a = orientation(first.from, first.to, second.from);
  const b = orientation(first.from, first.to, second.to);
  const c = orientation(second.from, second.to, first.from);
  const d = orientation(second.from, second.to, first.to);

  if (opposite(a, b) && opposite(c, d)) return true;
  if (a === 0 && isBetween(first.from, first.to, second.from)) return true;
  if (b === 0 && isBetween(first.from, first.to, second.to)) return true;
  if (c === 0 && isBetween(second.from, second.to, first.from)) return true;
  if (d === 0 && isBetween(second.from, second.to, first.to)) return true;
  return false;
}

/** Whether two orientations fall on opposite sides, so that a zero is not one of them. */
function opposite(a: number, b: number): boolean {
  return (a > 0 && b < 0) || (a < 0 && b > 0);
}
