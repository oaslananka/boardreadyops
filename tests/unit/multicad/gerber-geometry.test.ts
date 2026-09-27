import { describe, expect, it } from "vitest";
import type { GerberApertureDefinition } from "../../../src/multicad/gerber-apertures.js";
import {
  createGerberGeometryCollector,
  type GerberFileTransform,
  type GerberGeometry,
  pointToSegmentDistanceMm,
  readGerberCoordinate,
  readGerberTransform,
  segmentToSegmentDistanceMm,
} from "../../../src/multicad/gerber-geometry.js";
import { parseGerber } from "../../../src/multicad/gerber-parser.js";

/**
 * Measurable geometry, and the reasons it is not everything the artwork draws.
 *
 * These tests hold the three properties the module exists for, and each is asserted as a property
 * rather than as an example: a file's geometry is bounded, its uncertainty is named rather than
 * guessed, and a consumer cannot reach through the evidence and edit the file's own aperture table.
 */

const circle = (code: number, diameterMm: number): GerberApertureDefinition => ({
  code,
  shape: "circle",
  diameterMm,
  hole: undefined,
});

const apertureTable: readonly GerberApertureDefinition[] = [
  { code: 10, shape: "circle", diameterMm: 0.2, hole: { kind: "diameter", diameterMm: 0.05 } },
  { code: 11, shape: "rectangle", widthMm: 1.6, heightMm: 0.8, hole: undefined },
  { code: 12, shape: "obround", widthMm: 1.2, heightMm: 0.6, hole: undefined },
  { code: 13, shape: "polygon", diameterMm: 0.5, vertices: 6, rotationDegrees: undefined, hole: undefined },
  { code: 14, shape: "macro", macroName: "ROUNDRECT" },
  { code: 15, shape: "block" },
  { code: 16, shape: "unmodelled" },
];

const collectorOver = (
  overrides: {
    apertures?: readonly GerberApertureDefinition[];
    incremental?: boolean;
    clearPolarity?: boolean;
    transforms?: readonly GerberFileTransform[];
  } = {},
) =>
  createGerberGeometryCollector({
    apertures: overrides.apertures ?? apertureTable,
    incremental: overrides.incremental ?? false,
    clearPolarity: overrides.clearPolarity ?? false,
    transforms: overrides.transforms ?? [],
  });

describe("readGerberCoordinate", () => {
  const millimetres = { integerDigits: 3, decimalDigits: 6, zeroOmission: "leading" } as const;

  it("reads a coordinate word in the format the file declared", () => {
    expect(readGerberCoordinate("5000000", millimetres)).toBe(5);
    expect(readGerberCoordinate("5000000", { ...millimetres, decimalDigits: 5 })).toBe(50);
    expect(readGerberCoordinate("000005000", millimetres)).toBe(0.005);
  });

  it("reads a trailing-zero-omitted format as the count it stands for", () => {
    // `%FSTAX36Y36*%` drops trailing zeros, so the digits present are the low-order ones of a nine
    // digit word: "5" is 500 in that format and 0.000005 in a leading-zero one. Reading both the
    // same way is five orders of magnitude on a layer.
    const trailing = { integerDigits: 3, decimalDigits: 6, zeroOmission: "trailing" } as const;
    expect(readGerberCoordinate("5", trailing)).toBe(500);
    expect(readGerberCoordinate("5000000", trailing)).toBe(500);
    expect(readGerberCoordinate("5", millimetres)).toBe(0.000005);
  });

  it("keeps the sign of a negative coordinate", () => {
    expect(readGerberCoordinate("-2500000", millimetres)).toBe(-2.5);
  });
});

describe("readGerberTransform", () => {
  it("recognises the three transformation families and step and repeat", () => {
    expect(readGerberTransform("LM*")).toBe("mirror");
    expect(readGerberTransform("LMX*")).toBe("mirror");
    expect(readGerberTransform("LMY*")).toBe("mirror");
    expect(readGerberTransform("LMXY*")).toBe("mirror");
    // `%LR90*%` is the spec's simplest rotation and `%LS2*%` its simplest scale. A grammar that
    // demanded a modifier letter would read the commonest way of writing either as no transform at
    // all, and a layer whose aperture is rotated would be reported as exactly measured.
    expect(readGerberTransform("LR*")).toBe("rotation");
    expect(readGerberTransform("LR90*")).toBe("rotation");
    expect(readGerberTransform("LR-90*")).toBe("rotation");
    expect(readGerberTransform("LRA90*")).toBe("rotation");
    expect(readGerberTransform("LR1.5I2.0*")).toBe("rotation");
    expect(readGerberTransform("LS*")).toBe("scale");
    expect(readGerberTransform("LS2*")).toBe("scale");
    expect(readGerberTransform("LSX2Y3*")).toBe("scale");
    expect(readGerberTransform("SRX2Y3I5.0J4.0*")).toBe("step-and-repeat");
    // The pre-X2 spellings of a step and repeat repeat, and are not applied here either.
    expect(readGerberTransform("SRX2Y3*")).toBe("step-and-repeat");
    expect(readGerberTransform("SR3*")).toBe("step-and-repeat");
  });

  it("leaves the Gerber graphics-state identity resets uncalled", () => {
    expect(readGerberTransform("LMN*")).toBeUndefined();
    for (const command of ["LR0*", "LR0.0*", "LR-0.0*", "LR+0.0*"]) {
      expect(readGerberTransform(command), command).toBeUndefined();
    }
    for (const command of ["LS1*", "LS1.0*", "LS+1.0*"]) {
      expect(readGerberTransform(command), command).toBeUndefined();
    }

    // A malformed transform-family body still fails closed instead of being mistaken for identity.
    expect(readGerberTransform("LR0.0.0*")).toBe("rotation");
    expect(readGerberTransform("LS1.0.0*")).toBe("scale");
  });

  it("does not read a polarity, a saved image or a name as a transformation", () => {
    // `L` and `S` are not only transformation families. Reading every `L*` command as one would
    // mark an ordinary layer incomplete for a polarity it declares and this reader needs to act on.
    for (const command of [
      "LPD*",
      "LPC*",
      "LNMYIMAGE*",
      "LPMYIMAGE*",
      "LRX2*",
      "LSZ3*",
      "ADD10C,0.1*",
      "AB*",
      "FSLAX36Y36*",
    ]) {
      expect(readGerberTransform(command), command).toBeUndefined();
    }
  });

  it("leaves a step and repeat that copies nothing uncalled", () => {
    // `%SRX1Y1I0J0*%` is what ordinary CAM output writes on every layer it exports. One copy in each
    // direction with no offset repeats nothing, and refusing to measure every honest board over it
    // would be a report nobody could act on.
    expect(readGerberTransform("SRX1Y1I0J0*")).toBeUndefined();
    expect(readGerberTransform("SR1*")).toBeUndefined();
    expect(readGerberTransform("SR*")).toBeUndefined();

    // A repetition with an offset copies, even at one copy per axis, and is still not applied here.
    expect(readGerberTransform("SRX1Y1I5.0J0*")).toBe("step-and-repeat");
  });

  it("reads a step and repeat that names only one axis, as the spec allows", () => {
    // `X` and `Y` count copies and `I`/`J` offset them, and the spec lets each of the four be left out
    // on its own. A grammar that required the pair would read `%SRX2*%` as no repetition at all, and
    // publish a panel's untransformed artwork as though the file had drawn it once.
    expect(readGerberTransform("SRX2*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRY3*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRX2Y2J1.0*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRI5.0*")).toBe("step-and-repeat");
    // One copy on one axis with no offset still copies nothing on either.
    expect(readGerberTransform("SRX1*")).toBeUndefined();
    expect(readGerberTransform("SRY1*")).toBeUndefined();
  });

  it("treats a repetition it cannot read as one, rather than as none", () => {
    // The one fail-closed answer in this module. Whatever this grammar does not understand, the file
    // stated a repetition and this reader did not apply it, so the layer it is unsure about is the
    // layer it is unsure about.
    expect(readGerberTransform("SRX*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRQ2*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRX2Y2J*")).toBe("step-and-repeat");
  });

  it("answers a repetition from the one thing each of its values can say", () => {
    // A count of one and an offset of zero is the identity, however the file spells the numbers:
    // `%SRX1.0Y1.0I0.0J0.0*%` copies nothing, and so does a signed zero, which displaces nothing.
    expect(readGerberTransform("SRX1.0Y1.0I0.0J0.0*")).toBeUndefined();
    expect(readGerberTransform("SRI-0.0*")).toBeUndefined();

    // An offset of one is not an identity: a second copy displaced by a unit is a panel, and
    // publishing it as the artwork drawn once is the measurement this whole module refuses to make.
    expect(readGerberTransform("SRI1*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRJ1.0*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRX1Y1I0J0I5.0*")).toBe("step-and-repeat");

    // A count of zero is not an identity either, and it is the case that is easiest to get wrong: it
    // says the file plots no copy on that axis at all, so the objects inside the block are copper it
    // said it would not lay down. Every primitive collected would really have been plotted, which is
    // exactly why publishing them as the layer is an absence reported as a measurement.
    expect(readGerberTransform("SRX0*")).toBe("step-and-repeat");
    expect(readGerberTransform("SRX0.0Y1*")).toBe("step-and-repeat");
    expect(readGerberTransform("SR0*")).toBe("step-and-repeat");
  });

  it("stays roughly linear time on a long adversarial body (ReDoS guard)", () => {
    // A run of digits splits between consecutive numbers in as many ways as there are digits, and
    // the body that turns out not to match is where a grammar of numbers walks every one of them:
    // sixty-four digits is 2^64 of them, and the file chooses how long its body is. The bodies below
    // are the ones such a grammar could not answer -- one with nothing after the digits, one with a
    // letter that is not a parameter, and one that does match -- and the bound is deliberately far
    // above the microseconds reading them costs and far below the years the arithmetic would take.
    const rotation = `LR${"1".repeat(64)}`;
    const startedAt = performance.now();
    expect(readGerberTransform(rotation)).toBeUndefined();
    expect(readGerberTransform(`${rotation}Z*`)).toBeUndefined();
    expect(readGerberTransform(`${rotation}*`)).toBe("rotation");
    expect(readGerberTransform(`SR${"1".repeat(64)}*`)).toBe("step-and-repeat");
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("reads a malformed body as the transformation it is trying to state, rather than as none", () => {
    // A body made of its own family's parameter characters *is* that family stating the
    // transformation, however impossible its decimal points and signs are in the middle. The bodies
    // below are the ones a structure of numbers would have refused, and refusing them would report
    // a layer as exactly measured on the strength of a spelling that could not be parsed.
    expect(readGerberTransform("LR1.2.3*")).toBe("rotation");
    expect(readGerberTransform("LS.5*")).toBe("scale");
    // A letter from outside the family is still not a parameter, which is what keeps `%LPD*%`,
    // `%LN<name>*%` and `%LRX2*%` out of this.
    expect(readGerberTransform("LRX2*")).toBeUndefined();
    expect(readGerberTransform("LSZ3*")).toBeUndefined();
  });
});

describe("createGerberGeometryCollector", () => {
  it("claims a swept width only for the one template whose width does not depend on direction", () => {
    const collector = collectorOver();
    collector.segment({ x: 0, y: 0 }, { x: 5, y: 0 }, { inRegion: false, apertureCode: 10 });
    collector.segment({ x: 0, y: 0 }, { x: 0, y: 5 }, { inRegion: false, apertureCode: 11 });
    collector.segment({ x: 0, y: 0 }, { x: 3, y: 4 }, { inRegion: false, apertureCode: 12 });
    collector.segment({ x: 0, y: 0 }, { x: 3, y: 4 }, { inRegion: false, apertureCode: 13 });

    const [round, box, obround, polygon] = collector.evidence().primitives;
    // A circle is as wide whichever way the file travelled, and its hole does not narrow it.
    expect(round).toMatchObject({ kind: "segment", widthMm: 0.2 });
    // A rectangle, an obround and a polygon are swept with a cross-section facing across the path,
    // and which of their dimensions does that depends on the direction of travel. `undefined` means
    // "not claimed", never zero.
    expect(box).toMatchObject({ kind: "segment", widthMm: undefined });
    expect(obround).toMatchObject({ kind: "segment", widthMm: undefined });
    expect(polygon).toMatchObject({ kind: "segment", widthMm: undefined });
    // Refusing a width is not the same as doubting the path, so nothing here is uncertain.
    expect(collector.evidence()).toMatchObject({ incomplete: false, uncertainty: [] });
  });

  it("publishes the copper a flash covers, with a hole named as the void it is", () => {
    const collector = collectorOver();
    collector.flash({ x: 1, y: 2 }, { inRegion: false, apertureCode: 10 });
    collector.flash({ x: 3, y: 4 }, { inRegion: false, apertureCode: 11 });
    collector.flash({ x: 5, y: 6 }, { inRegion: false, apertureCode: 12 });
    collector.flash({ x: 7, y: 8 }, { inRegion: false, apertureCode: 13 });

    const primitives = collector.evidence().primitives;
    expect(primitives[0]).toEqual({
      kind: "flash",
      at: { x: 1, y: 2 },
      inRegion: false,
      apertureCode: 10,
      // The 0.2 mm disc is the copper; the 0.05 mm hole is what is missing from the middle of it.
      aperture: { code: 10, shape: "circle", diameterMm: 0.2, hole: { kind: "diameter", diameterMm: 0.05 } },
    });
    expect(primitives[1]).toMatchObject({ aperture: { shape: "rectangle", widthMm: 1.6, heightMm: 0.8 } });
    expect(primitives[2]).toMatchObject({ aperture: { shape: "obround", widthMm: 1.2, heightMm: 0.6 } });
    expect(primitives[3]).toMatchObject({ aperture: { shape: "polygon", diameterMm: 0.5, vertices: 6 } });
    expect(collector.evidence().incomplete).toBe(false);
  });

  it("places an aperture it cannot measure without claiming any extent for it", () => {
    const collector = collectorOver();
    for (const apertureCode of [14, 15, 16]) {
      collector.flash({ x: 0, y: 0 }, { inRegion: false, apertureCode });
    }

    const evidence = collector.evidence();
    // A macro, a block and a definition it could not read are three different files' mistakes, and
    // all three are this reader's limit rather than evidence about the file.
    expect(
      evidence.primitives.map((primitive) => (primitive.kind === "flash" ? primitive.aperture : "not a flash")),
    ).toEqual([undefined, undefined, undefined]);
    expect(evidence.primitives.every((primitive) => primitive.kind === "flash" && primitive.at.x === 0)).toBe(true);
    expect(evidence.uncertainty).toEqual(["unsupported-aperture"]);
  });

  it("tells an aperture the file never defined from one it could not measure", () => {
    const collector = collectorOver();
    collector.flash({ x: 0, y: 0 }, { inRegion: false, apertureCode: 99 });
    collector.flash({ x: 0, y: 0 }, { inRegion: false, apertureCode: 14 });
    collector.flash({ x: 0, y: 0 }, { inRegion: false, apertureCode: undefined });

    // A rule has to be able to tell the two apart, because only the second is evidence about the
    // file rather than about this reader. The order is the order the file first ran into each one.
    expect(collector.evidence().uncertainty).toEqual(["undefined-aperture", "unsupported-aperture"]);
  });

  it("records one reason per kind of thing rather than one per operation", () => {
    const collector = collectorOver();
    for (let index = 0; index < 500; index += 1) {
      collector.flash({ x: index, y: 0 }, { inRegion: false, apertureCode: 14 });
      collector.segment({ x: index, y: 0 }, { x: index, y: 1 }, { inRegion: false, apertureCode: 10 });
    }
    collector.uncertain("unsupported-interpolation");
    collector.uncertain("unsupported-interpolation");

    // A thousand plotted objects the reader cannot fully model are one reason, not a thousand: the
    // uncertainty list is a property of the file, not of how large the file is.
    expect(collector.evidence().uncertainty).toEqual(["unsupported-aperture", "unsupported-interpolation"]);
    expect(collector.evidence().primitives).toHaveLength(1_000);
  });

  it("marks the contour a region drew, and only the contours inside it", () => {
    const collector = collectorOver();
    collector.segment({ x: 0, y: 0 }, { x: 1, y: 0 }, { inRegion: true, apertureCode: 10 });
    collector.segment({ x: 1, y: 0 }, { x: 1, y: 1 }, { inRegion: false, apertureCode: 10 });
    collector.flash({ x: 2, y: 2 }, { inRegion: true, apertureCode: 10 });

    expect(collector.evidence().primitives.map((primitive) => primitive.inRegion)).toEqual([true, false, true]);
  });

  it("claims no width from the aperture across a region, and doubts it none the more", () => {
    // The format does not apply the selected aperture to a region: the copper inside the contour is
    // the fill and the contour is only its edge. CAM output leaves whatever aperture was last
    // selected in force across a whole fill, so treating that D-code as a stroke would publish a
    // width for copper the file never asked for, and doubting it would refuse an ordinary KiCad zone
    // for a reason the file never gave.
    const collector = collectorOver();
    collector.segment({ x: 0, y: 0 }, { x: 4, y: 0 }, { inRegion: true, apertureCode: 10 });
    collector.segment({ x: 4, y: 0 }, { x: 4, y: 4 }, { inRegion: true, apertureCode: 14 });
    collector.segment({ x: 4, y: 4 }, { x: 0, y: 4 }, { inRegion: true, apertureCode: undefined });
    // A `D03` between `G36` and `G37` is a degenerate contour the format collapses to the point it
    // names, not a pad, so the same aperture covers a point here exactly as little as it covers an
    // edge. Publishing the 0.2 mm disc would be copper the file never laid down, and a downstream
    // rule measuring clearance to it would be measuring a pad that is not on the layer.
    collector.flash({ x: 2, y: 2 }, { inRegion: true, apertureCode: 10 });

    // A circle, a macro and a flash are all refused the same way, and none of them is a doubt: a
    // region is the line the file stated, whatever was selected while it stated it.
    expect(
      collector
        .evidence()
        .primitives.map((primitive) => ("widthMm" in primitive ? primitive.widthMm : primitive.aperture)),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(collector.evidence()).toMatchObject({ incomplete: false, uncertainty: [] });
  });

  it("stops at a finite primitive budget and says it stopped", () => {
    const collector = collectorOver();
    for (let index = 0; index < 25_001; index += 1) {
      collector.flash({ x: index, y: 0 }, { inRegion: false, apertureCode: 10 });
    }

    const evidence = collector.evidence();
    // The budget is a fixed count, so the same file yields the same geometry on every machine.
    expect(evidence.primitives).toHaveLength(25_000);
    expect(evidence.uncertainty).toEqual(["primitive-limit"]);
    expect(evidence.incomplete).toBe(true);
    // Collection after the budget is refused rather than accumulated, and the reason is not repeated.
    collector.flash({ x: 99_999, y: 0 }, { inRegion: false, apertureCode: 10 });
    expect(collector.evidence()).toMatchObject({ uncertainty: ["primitive-limit"] });
    expect(collector.evidence().primitives).toHaveLength(25_000);
  });

  it("is incomplete from the start for a file it refuses or cannot apply", () => {
    expect(collectorOver({ incremental: true }).evidence()).toEqual({
      primitives: [],
      incomplete: true,
      uncertainty: ["incremental-coordinates"],
    });

    // Copper the file erased is copper the list below is not an account of, and nothing here composes
    // a clear operation against the dark ones around it.
    expect(collectorOver({ clearPolarity: true }).evidence().uncertainty).toEqual(["clear-polarity"]);

    // Two transforms that both cost the same measurement are still one entry, and step and repeat
    // keeps its own name because a repetition is not a transformation of a single plotted object.
    const mirrored = collectorOver({ transforms: ["mirror", "rotation", "scale"] }).evidence();
    expect(mirrored.uncertainty).toEqual(["object-transform"]);

    const repeated = collectorOver({ transforms: ["step-and-repeat"] }).evidence();
    expect(repeated.uncertainty).toEqual(["step-and-repeat"]);
  });

  it("still names an aperture it cannot measure after the budget has stopped it", () => {
    // Whether the file drew with an aperture this reader cannot measure is a fact about the file, and
    // it holds for the objects the budget dropped as much as for the ones it kept.
    const collector = collectorOver();
    for (let index = 0; index < 25_000; index += 1) {
      collector.flash({ x: index, y: 0 }, { inRegion: false, apertureCode: 10 });
    }
    collector.flash({ x: 0, y: 0 }, { inRegion: false, apertureCode: 14 });

    expect(collector.evidence()).toMatchObject({
      // The aperture is resolved before the budget is asked, so the reason the file could not be
      // measured comes first and the truncation follows it.
      uncertainty: ["unsupported-aperture", "primitive-limit"],
      incomplete: true,
    });
    expect(collector.evidence().primitives).toHaveLength(25_000);
  });

  it("hands back evidence a consumer cannot use to edit the file's own aperture table", () => {
    const collector = collectorOver();
    collector.flash({ x: 1, y: 2 }, { inRegion: false, apertureCode: 10 });
    collector.segment({ x: 0, y: 0 }, { x: 1, y: 0 }, { inRegion: false, apertureCode: 10 });

    const evidence: GerberGeometry = collector.evidence();
    const [flash, segment] = evidence.primitives;
    if (flash?.kind !== "flash" || segment?.kind !== "segment") throw new Error("expected a flash and a segment");

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.primitives)).toBe(true);
    expect(Object.isFrozen(evidence.uncertainty)).toBe(true);
    expect(Object.isFrozen(flash)).toBe(true);
    expect(Object.isFrozen(flash.at)).toBe(true);
    expect(Object.isFrozen(flash.aperture)).toBe(true);
    expect(Object.isFrozen(flash.aperture?.hole)).toBe(true);
    expect(Object.isFrozen(segment.from)).toBe(true);

    // The file's aperture table is shared with everything else the parser publishes. A flash that
    // handed out the definition itself would let a consumer widen a pad for every later reader.
    expect(flash.aperture).not.toBe(apertureTable[0]);
    expect(() => {
      (flash.at as { x: number }).x = 99;
    }).toThrow(TypeError);
    expect(() => {
      (evidence.primitives as { length: number }).length = 0;
    }).toThrow(TypeError);
    const hole = flash.aperture?.hole;
    if (hole !== undefined) {
      expect(() => {
        (hole as { diameterMm: number }).diameterMm = 99;
      }).toThrow(TypeError);
    }
    expect(flash.at.x).toBe(1);
  });

  it("returns the same evidence however many times it is asked", () => {
    const collector = collectorOver();
    collector.flash({ x: 0, y: 0 }, { inRegion: false, apertureCode: 10 });

    const first = collector.evidence();
    const second = collector.evidence();
    expect(second).toEqual(first);
    // Each call hands out its own array rather than the one it accumulates into, so a consumer that
    // mutated the result could not have changed what the next caller is told.
    expect(Object.isFrozen(first.primitives)).toBe(true);
    expect(Object.isFrozen(second.primitives)).toBe(true);
    expect(second.primitives).not.toBe(first.primitives);
    collector.flash({ x: 1, y: 1 }, { inRegion: false, apertureCode: 10 });
    expect(first.primitives).toHaveLength(1);
    expect(collector.evidence().primitives).toHaveLength(2);
  });

  it("records a degenerate draw as the point it is rather than refusing it", () => {
    const collector = collectorOver();
    collector.segment({ x: 2, y: 3 }, { x: 2, y: 3 }, { inRegion: false, apertureCode: 10 });

    expect(collector.evidence().primitives).toEqual([
      {
        kind: "segment",
        from: { x: 2, y: 3 },
        to: { x: 2, y: 3 },
        inRegion: false,
        apertureCode: 10,
        widthMm: 0.2,
      },
    ]);
  });

  it("measures nothing as complete when a single aperture in the file could not be read", () => {
    // A collector given an empty table has no aperture to measure with, which is what a file that
    // plots before selecting anything looks like from here.
    const collector = collectorOver({ apertures: [] });
    collector.segment({ x: 0, y: 0 }, { x: 1, y: 0 }, { inRegion: false, apertureCode: undefined });

    expect(collector.evidence()).toMatchObject({ incomplete: true, uncertainty: ["undefined-aperture"] });
  });

  it("indexes the aperture table once so a dense layer does not cost a search per object", () => {
    const wide = Array.from({ length: 500 }, (_unused, index) => circle(index + 10, 0.1 + index / 1_000));
    const collector = collectorOver({ apertures: wide });
    for (let index = 0; index < 500; index += 1) {
      collector.flash({ x: index, y: 0 }, { inRegion: false, apertureCode: index + 10 });
    }

    expect(collector.evidence().incomplete).toBe(false);
    expect(collector.evidence().primitives[499]).toMatchObject({ aperture: { code: 509, diameterMm: 0.599 } });
  });
});

/**
 * A drawn path, built through the collector rather than written as a literal, so the distance
 * helpers are measured against the same value shape a consumer reads off a `GerberGeometry`.
 */
function trace(from: { x: number; y: number }, to: { x: number; y: number }) {
  const collector = createGerberGeometryCollector({
    apertures: [],
    incremental: false,
    clearPolarity: false,
    transforms: [],
  });
  collector.segment(from, to, { inRegion: false, apertureCode: undefined });
  const [segment] = collector.evidence().primitives;
  if (segment?.kind !== "segment") throw new Error("expected a segment");
  return segment;
}

describe("pointToSegmentDistanceMm", () => {
  it("measures to the nearest point on the path, not to one of its ends", () => {
    // The whole point of the helper: the nearest point on a path is inside it, and measuring to the
    // end would report a clearance the copper does not have.
    expect(pointToSegmentDistanceMm({ x: 5, y: 3 }, trace({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(3);
  });

  it("clamps to the end of the path when the projection falls outside it", () => {
    // (13,4) is 5 away from the end at (10,0) and 13.6 from the other end, so the answer is the end.
    expect(pointToSegmentDistanceMm({ x: 13, y: 4 }, trace({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(5);
    expect(pointToSegmentDistanceMm({ x: -4, y: 3 }, trace({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(5);
  });

  it("measures to the point itself when the path has no direction", () => {
    // A `D01` that lands where it started is a point on the layer, and this is the input a malformed
    // file is most likely to contain: there is nothing to project onto.
    expect(pointToSegmentDistanceMm({ x: 3, y: 4 }, trace({ x: 1, y: 1 }, { x: 1, y: 1 }))).toBeCloseTo(
      Math.hypot(2, 3),
      12,
    );
    expect(pointToSegmentDistanceMm({ x: 1, y: 1 }, trace({ x: 1, y: 1 }, { x: 1, y: 1 }))).toBe(0);
  });

  it("is zero for a point on the path", () => {
    expect(pointToSegmentDistanceMm({ x: 2, y: 0 }, trace({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(0);
  });
});

describe("segmentToSegmentDistanceMm", () => {
  it("reports two crossing paths as meeting rather than as far apart", () => {
    // A crossing pair is 0 apart in copper. Reporting a positive distance here would report a
    // clearance that does not exist in the artwork.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 10 }), trace({ x: 0, y: 10 }, { x: 10, y: 0 })),
    ).toBe(0);
  });

  it("reports paths that touch at an end as meeting", () => {
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 5, y: 0 }), trace({ x: 5, y: 0 }, { x: 5, y: 5 })),
    ).toBe(0);
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 5, y: 0 }), trace({ x: 0, y: 5 }, { x: 0, y: 0 })),
    ).toBe(0);
  });

  it("reports a collinear overlap as meeting, and a collinear gap as a gap", () => {
    // Overlapping paths share every point between them, so a positive distance would report a gap in
    // copper that is not there -- the failure mode that understates a clearance.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 0 }), trace({ x: 5, y: 0 }, { x: 15, y: 0 })),
    ).toBe(0);
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 0 }), trace({ x: 5, y: 0 }, { x: 5, y: 0 })),
    ).toBe(0);
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 0 }), trace({ x: 10, y: 0 }, { x: 20, y: 0 })),
    ).toBe(0);
    // A collinear pair that does not overlap is a real gap, and it is the gap between the two ends.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 0 }), trace({ x: 13, y: 0 }, { x: 20, y: 0 })),
    ).toBe(3);
  });

  it("measures the gap between parallel paths", () => {
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 0 }), trace({ x: 0, y: 2 }, { x: 10, y: 2 })),
    ).toBe(2);
    // Offset in both directions, so the gap is only attained at one pair of ends.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 10, y: 0 }), trace({ x: 3, y: 4 }, { x: 13, y: 4 })),
    ).toBe(4);
  });

  it("measures a diagonal pair from its nearest points, not from its centres", () => {
    // Two parallel 3-4 diagonals, the second displaced by (0.8,-0.6): perpendicular to the first, so
    // the whole of one path is 1 away from the whole of the other.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 3, y: 4 }), trace({ x: 0.8, y: -0.6 }, { x: 3.8, y: 3.4 })),
    ).toBeCloseTo(1, 12);
    // A pair of diagonals drawn along the same line is one path, not two with a gap between them.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 3, y: 4 }), trace({ x: 0.75, y: 1 }, { x: 3.75, y: 5 })),
    ).toBe(0);
    // Two paths with nothing in common anywhere near each other: the gap is between an end of one
    // and an end of the other, which is a corner rather than the midpoint of either path.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 3, y: 0 }), trace({ x: 10, y: 0 }, { x: 10, y: 4 })),
    ).toBe(7);
  });

  it("measures a path against one that has no direction at all", () => {
    // A degenerate path meets nothing, and is measured from the point it is.
    expect(
      segmentToSegmentDistanceMm(trace({ x: 0, y: 0 }, { x: 0, y: 0 }), trace({ x: 10, y: 0 }, { x: 20, y: 0 })),
    ).toBe(10);
    expect(
      segmentToSegmentDistanceMm(trace({ x: 4, y: 3 }, { x: 4, y: 3 }), trace({ x: 0, y: 0 }, { x: 10, y: 0 })),
    ).toBe(3);
  });
});

/**
 * The geometry a real file yields, read through the parser.
 *
 * The collector is fed by the parser's artwork walk, so every property the collector holds can be
 * broken by the wiring between them: a `D10` that the walk reads in the wrong place, a region flag
 * that reaches the wrong contour, a budget that stops the walk rather than the list, an arc mode the
 * walk forgets is modal. These are the files that break those things, in the shape a CAM tool writes
 * them, with a 3.6 format so that a millimetre is a million digits.
 */
describe("geometry read through parseGerber", () => {
  const preamble = ["%FSLAX36Y36*%", "%MOMM*%", "%ADD10C,0.2*%", "%ADD11R,1.6X0.8*%", "D10*"];

  /** One millimetre in a 3.6 leading-zero format, as a coordinate word. */
  const mm = (value: number) => `${Math.round(value * 1_000_000)}`;

  const gerber = (...lines: string[]) => `${[...preamble, ...lines, "M02*"].join("\n")}\n`;

  it("measures a trace, a flash and a region from the same walk that reads the extents", () => {
    const result = parseGerber(
      gerber(
        "X0Y0D02*",
        `X${mm(4)}Y0D01*`,
        `X${mm(2)}Y${mm(2)}D03*`,
        "G36*",
        `X${mm(10)}Y0D02*`,
        `X${mm(10)}Y${mm(10)}D01*`,
        `X${mm(0)}Y${mm(10)}D01*`,
        "G37*",
      ),
    );

    const { geometry } = result;
    expect(geometry.primitives).toEqual([
      { kind: "segment", from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, inRegion: false, apertureCode: 10, widthMm: 0.2 },
      {
        kind: "flash",
        at: { x: 2, y: 2 },
        inRegion: false,
        apertureCode: 10,
        aperture: { code: 10, shape: "circle", diameterMm: 0.2, hole: undefined },
      },
      {
        kind: "segment",
        from: { x: 10, y: 0 },
        to: { x: 10, y: 10 },
        inRegion: true,
        apertureCode: 10,
        widthMm: undefined,
      },
      {
        kind: "segment",
        from: { x: 10, y: 10 },
        to: { x: 0, y: 10 },
        inRegion: true,
        apertureCode: 10,
        widthMm: undefined,
      },
    ]);
    // An ordinary layer: every aperture it drew with is one this reader can measure, and a region
    // contour is a line the file stated rather than a stroke it asked an aperture for.
    expect(geometry).toMatchObject({ incomplete: false, uncertainty: [] });
    expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 });
  });

  it("measures each object with the aperture the file had selected when it drew it", () => {
    const result = parseGerber(
      gerber("X0Y0D02*", "X4000000Y0D01*", "D11*", "X2000000Y2000000D03*", "D10*", "X2000000Y0D03*"),
    );

    // A rectangle flash is publishable copper; a rectangle trace is not, because which of its two
    // dimensions lies across the path depends on the direction of travel.
    expect(result.geometry.primitives[0]).toMatchObject({ kind: "segment", apertureCode: 10, widthMm: 0.2 });
    expect(result.geometry.primitives[1]).toMatchObject({
      kind: "flash",
      aperture: { code: 11, shape: "rectangle", widthMm: 1.6, heightMm: 0.8 },
    });
    expect(result.geometry.primitives[2]).toMatchObject({ kind: "flash", aperture: { code: 10, shape: "circle" } });
    expect(result.geometry.incomplete).toBe(false);
  });

  it("stops at its primitive budget mid-file and keeps reading the rest of the file", () => {
    // 25_001 flashes in a row, one every 0.01 mm: the budget is reached inside the artwork rather
    // than at the end of it, and the whole file stays inside what a 3.6 format can state.
    const flashes = Array.from({ length: 25_001 }, (_unused, index) => `X${mm(index / 100)}Y0D03*`);
    const result = parseGerber(gerber("X0Y0D02*", ...flashes));

    // The list stops at the budget and says so, rather than growing with a file this repository does
    // not control.
    expect(result.geometry.primitives).toHaveLength(25_000);
    expect(result.geometry.uncertainty).toEqual(["primitive-limit"]);
    expect(result.geometry.incomplete).toBe(true);
    // The walk carries on past the budget: everything else the file says about itself -- here its
    // extents, which are read on the same walk -- is unaffected by where the geometry stopped, so the
    // last flash of the file is still inside the bounding box.
    expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 250, minY: 0, maxY: 0 });
    expect(result.hasClosedContour).toBe(false);
  });

  it("does not publish the chord of an arc, whether the mode is stated on its own line or not", () => {
    const result = parseGerber(
      gerber("X0Y0D02*", "G02*", `X${mm(1)}Y${mm(1)}I${mm(1)}J0D01*`, "G01*", `X${mm(2)}Y0D01*`),
    );

    // `G02*` is modal: the draw that follows it is an arc even though the draw itself names no
    // interpolation code, and its chord is not a trace the fabricator cut. The linear draw after the
    // `G01*` is measured normally.
    expect(result.geometry.primitives).toEqual([
      { kind: "segment", from: { x: 1, y: 1 }, to: { x: 2, y: 0 }, inRegion: false, apertureCode: 10, widthMm: 0.2 },
    ]);
    expect(result.geometry.uncertainty).toEqual(["unsupported-interpolation"]);
    expect(result.geometry.incomplete).toBe(true);
    // The arc's own points are still on the layer, and the extents still cover them.
    expect(result.boundingBoxMm).toEqual({ minX: 0, maxX: 2, minY: 0, maxY: 1 });
  });

  it("carries an unapplied transformation and an unapplied repetition into the uncertainty", () => {
    const rotated = parseGerber(gerber("X0Y0D02*", "X4000000Y0D01*").replace("%ADD11R,1.6X0.8*%", "%LR90*%"));
    expect(rotated.geometry.uncertainty).toEqual(["object-transform"]);
    expect(rotated.geometry.incomplete).toBe(true);
    // The path is where the untransformed aperture put it, which is the whole reason the geometry is
    // not published as a measurement of the copper: nothing here applies the rotation.
    expect(rotated.geometry.primitives).toHaveLength(1);

    const repeated = parseGerber(gerber("X0Y0D02*", "X4000000Y0D01*").replace("%ADD11R,1.6X0.8*%", "%SRX2Y2I5.0J0*%"));
    expect(repeated.geometry.uncertainty).toEqual(["step-and-repeat"]);

    // Gerber's explicit no-mirror, zero-rotation and unity-scale commands are graphics-state resets,
    // not unapplied transforms. They must not turn an otherwise exact layer into false uncertainty.
    const identityTransforms = parseGerber(gerber("%LMN*%", "%LR0.0*%", "%LS1.0*%", "X0Y0D02*", "X4000000Y0D01*"));
    expect(identityTransforms.geometry.uncertainty).toEqual([]);
    expect(identityTransforms.geometry.incomplete).toBe(false);

    // The identity repetition ordinary CAM output writes on every layer copies nothing, and a file
    // that states it is still measured.
    const identity = parseGerber(gerber("X0Y0D02*", "X4000000Y0D01*").replace("%ADD11R,1.6X0.8*%", "%SRX1Y1I0J0*%"));
    expect(identity.geometry.uncertainty).toEqual([]);
    expect(identity.geometry.incomplete).toBe(false);

    // A count of zero is not an identity, and the file has to say so because the geometry cannot: the
    // objects inside the block really were plotted, so a complete list of them is a complete account
    // of artwork the file never put down.
    const unplotted = parseGerber(gerber("X0Y0D02*", "X4000000Y0D01*").replace("%ADD11R,1.6X0.8*%", "%SRX0Y0*%"));
    expect(unplotted.geometry.primitives).toHaveLength(1);
    expect(unplotted.geometry.uncertainty).toEqual(["step-and-repeat"]);
    expect(unplotted.geometry.incomplete).toBe(true);
  });

  it("reads a command that both opens a region and selects an aperture", () => {
    // `G36D10*` is one word command carrying both, and a reader that treated it as nothing but the
    // selection would drop the `G36` and mark every contour after it as traced copper rather than as
    // a region edge -- the opposite of what the file wrote, on a command the format allows.
    const result = parseGerber(gerber("G36D10*", `X${mm(1)}Y0D02*`, `X${mm(1)}Y${mm(1)}D01*`, "G37*"));

    // The selection is honoured and the region is honoured, in the one command that states both.
    expect(result.geometry.primitives).toEqual([
      {
        kind: "segment",
        from: { x: 1, y: 0 },
        to: { x: 1, y: 1 },
        inRegion: true,
        apertureCode: 10,
        // A region edge is a line the file stated, not a stroke it asked an aperture for, so the
        // aperture in force across the fill publishes no width.
        widthMm: undefined,
      },
    ]);
    expect(result.geometry.incomplete).toBe(false);
  });

  it("publishes a flash inside a region as the point it is, not as a pad", () => {
    // A `D03` between `G36` and `G37` is a degenerate contour, which the format collapses to the
    // point the file named. The aperture in force across the fill covers a point exactly as little
    // as it covers a region edge, so the flash answers the same way the edge above does.
    const result = parseGerber(
      gerber("G36*", `X${mm(1)}Y0D02*`, `X${mm(1)}Y${mm(1)}D01*`, `X${mm(2)}Y${mm(2)}D03*`, "G37*", `X${mm(5)}Y0D03*`),
    );

    const [edge, inside, outside] = result.geometry.primitives;
    expect(edge).toMatchObject({ kind: "segment", inRegion: true, widthMm: undefined });
    // The point is still a point the file plotted and is still on the layer; what it is not is a
    // 0.2 mm disc, so nothing here is claimed about the copper around it.
    expect(inside).toEqual({
      kind: "flash",
      at: { x: 2, y: 2 },
      inRegion: true,
      apertureCode: 10,
      aperture: undefined,
    });
    // The same `D03` after `G37` is an ordinary pad, which is what makes the difference observable
    // at all: one D-code, one aperture, and the region is the only thing that changed the answer.
    expect(outside).toMatchObject({ kind: "flash", inRegion: false, aperture: { shape: "circle", diameterMm: 0.2 } });
    // Neither the point nor the pad is a doubt, so a file that does this is not reported incomplete.
    expect(result.geometry.uncertainty).toEqual([]);
    expect(result.geometry.incomplete).toBe(false);
  });

  it("says so when the file erases copper rather than adding it", () => {
    const cleared = parseGerber(
      ["%FSLAX36Y36*%", "%MOMM*%", "%ADD10C,0.2*%", "D10*", "%LPC*%", "X0Y0D02*", "X4000000Y0D01*", "M02*"].join("\n"),
    );
    // The object was plotted and the geometry lists it, but a clear operation removes copper: this
    // list is an account of what the file drew, not of what is left on the layer.
    expect(cleared.geometry.primitives).toHaveLength(1);
    expect(cleared.geometry.uncertainty).toEqual(["clear-polarity"]);

    // A `%LPD*%` is the default polarity, and restating it is not a doubt.
    const dark = parseGerber(
      ["%FSLAX36Y36*%", "%MOMM*%", "%ADD10C,0.2*%", "%LPD*%", "D10*", "X0Y0D02*", "X4000000Y0D01*", "M02*"].join("\n"),
    );
    expect(dark.geometry.uncertainty).toEqual([]);
    expect(dark.geometry.incomplete).toBe(false);
  });

  it("keeps the uncertainty list and the warnings of a file full of unmeasurable objects bounded", () => {
    const content = [
      "%FSLAX36Y36*%",
      "%MOMM*%",
      "%AMDONUT*1,1,0*%",
      "%ADD14DONUT*%",
      "D14*",
      ...Array.from({ length: 2_000 }, (_unused, index) => `X${mm(index / 100)}Y0D03*`),
      "M02*",
    ].join("\n");
    const result = parseGerber(content);

    // Two thousand macro flashes are one reason and no warnings at all: the geometry evidence is where
    // this belongs, and a per-operation warning would make the public warning list a function of how
    // large the file is.
    expect(result.geometry.uncertainty).toEqual(["unsupported-aperture"]);
    expect(result.geometry.primitives).toHaveLength(2_000);
    expect(result.warnings).toEqual([]);
  });
});
