import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, writeFixture } from "../helpers.js";

/**
 * A stencil is required by a side that actually carries surface-mount assembly, and only that.
 *
 * The boards are the real pad-bearing fixtures from #784, because the mount type is read from the
 * pads: a footprint with `(attr smd)` and a footprint with SMD pads are the same check, and an
 * inline one-line board proves nothing about it. The package half of the rule is equally about
 * provenance -- a layer missing from a package whose files all declare `TF.FileFunction` is missing,
 * while a layer missing from a package identified by filename is an inference about names. Part of
 * #770, split out as #848.
 */

const fixtureRoot = path.resolve("tests/fixtures/kicad/mount-types");
const mountTypeBoard = (file: string) => fs.readFile(path.join(fixtureRoot, file), "utf8");

const enabled = "version: 1\nrules:\n  manufacturing.paste-coverage:\n    enabled: true\nfail-on: never\n";
const blockingConfig =
  "version: 1\nrules:\n  manufacturing.paste-coverage:\n    enabled: true\n    severity: high\nfail-on: never\n";
const advisoryConfig =
  "version: 1\nrules:\n  manufacturing.paste-coverage:\n    enabled: true\n    severity: low\nfail-on: never\n";

const header = ["%FSLAX36Y36*%", "%MOMM*%"];
const layer = (fileFunction: string) =>
  [...header, `%TF.FileFunction,${fileFunction}*%`, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");
const plainLayer = [...header, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");

/**
 * A pad-bearing footprint that still states no mount type.
 *
 * A card-edge footprint's pads are `connect`, which is neither `smd` nor `thru_hole`, and it
 * carries no `(attr ...)`. So the mount type stays `unknown` on a footprint that plainly has
 * pads -- the presence of pads is not itself a mount type, which is exactly what the rule has to
 * get right and what a footprint with no pads at all would not show.
 */
const unknownMountTypeBoard = `(kicad_pcb
  (footprint "Connector_Card:CardEdge_1x02" (layer "F.Cu") (at 100 100)
    (property "Reference" "J1")
    (property "Value" "CardEdge")
    (pad "" connect rect (at 0 0) (size 2 1.5) (layers "F.Cu" "F.Mask"))
    (pad "" connect rect (at 2.54 0) (size 2 1.5) (layers "F.Cu" "F.Mask"))
  )
)`;

/** A package whose files each state what they are, which is what makes an absence readable. */
const declaredPackage = {
  "fab/top-copper.gbr": layer("Copper,L1,Top"),
  "fab/top-mask.gbr": layer("Soldermask,Top"),
  "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
  "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
};

async function run(pcbContent: string, files: Record<string, string>, configText = enabled) {
  const root = await writeFixture({
    "board.kicad_pro": "{}",
    "board.kicad_sch": "(kicad_sch)",
    "board.kicad_pcb": pcbContent,
    "boardreadyops.yml": configText,
    ...files,
  });
  return await runPipeline({ path: root, rules: ["manufacturing.paste-coverage"], failOn: "never" });
}

describe("manufacturing.paste-coverage", () => {
  it("flags a side with SMT components that lacks a solder paste layer", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
    });

    const findings = expectRule(result, "manufacturing.paste-coverage", 1);
    expect(findings[0]?.message).toContain("top side, but the Gerber package lacks a top solder paste");
    expect(findings[0]?.details).toMatchObject({ side: "top", pasteLayers: 0 });
    expect(findings[0]?.fix?.description).toContain("Export the top solder paste layer (F.Paste)");
    expect(findings[0]?.fix?.steps).toHaveLength(3);
    expect(findings[0]?.fix?.steps?.[0]).toContain("In KiCad, open File > Fabrication Outputs > Gerbers.");
  });

  it("flags bottom-side SMT assembly missing bottom paste layer", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "B.Cu") (at 1 1) (attr smd) (property "Reference" "R2")))`;
    const result = await run(pcb, {
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
      "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
    });

    const findings = expectRule(result, "manufacturing.paste-coverage", 1);
    expect(findings[0]?.message).toContain("bottom side, but the Gerber package lacks a bottom solder paste");
    expect(findings[0]?.details).toMatchObject({ side: "bottom", pasteLayers: 0 });
    expect(findings[0]?.fix?.description).toContain("Export the bottom solder paste layer (B.Paste)");
  });

  it("passes when SMT side has matching paste stencil layer", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/top-paste.gbr": layer("Paste,Top"),
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("does not require paste for DNP footprints", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd dnp) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("does not require paste for through-hole-only components", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:Resistor_THT" (layer "F.Cu") (at 1 1) (attr through_hole) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("requires paste for mixed assembly only on the side with SMT components", async () => {
    const pcb = `(kicad_pcb
      (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1"))
      (footprint "Lib:Header_THT" (layer "B.Cu") (at 5 5) (attr through_hole) (property "Reference" "J1"))
    )`;
    const result = await run(pcb, {
      "fab/top-copper.gbr": layer("Copper,L1,Top"),
      "fab/top-mask.gbr": layer("Soldermask,Top"),
      "fab/bottom-copper.gbr": layer("Copper,L2,Bot"),
      "fab/bottom-mask.gbr": layer("Soldermask,Bot"),
    });

    const findings = expectRule(result, "manufacturing.paste-coverage", 1);
    expect(findings[0]?.details).toMatchObject({ side: "top" });
  });

  it("reads plain Gerber filenames when metadata is missing", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const result = await run(pcb, {
      "fab/board.gtl": plainLayer,
      "fab/board.gts": plainLayer,
      "fab/board.gtp": plainLayer,
    });

    expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  it("returns no findings when rule is disabled or no Gerbers exist", async () => {
    const pcb = `(kicad_pcb (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R1")))`;
    const disabledConfig = "version: 1\nrules:\n  manufacturing.paste-coverage:\n    enabled: false\nfail-on: never\n";
    const disabledRes = await run(
      pcb,
      {
        "fab/top-copper.gbr": layer("Copper,L1,Top"),
      },
      disabledConfig,
    );
    expect(expectRule(disabledRes, "manufacturing.paste-coverage", 0)).toEqual([]);

    const noGerbersRes = await run(pcb, {});
    expect(expectRule(noGerbersRes, "manufacturing.paste-coverage", 0)).toEqual([]);
  });

  describe("which sides actually need a stencil", () => {
    it("requires a top stencil for a board with SMD pads", async () => {
      const result = await run(await mountTypeBoard("surface-mount.kicad_pcb"), declaredPackage);

      // The mount type comes from the pads, not from `(attr smd)`, which this board also carries:
      // the fixture proves the pad-bearing path the rule reads.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.details).toMatchObject({
        side: "top",
        smdFootprints: 1,
        smdReferences: ["R1"],
        throughHoleFootprints: 0,
        unknownMountTypeFootprints: 0,
      });
    });

    it("does not require a stencil for a through-hole board", async () => {
      const result = await run(await mountTypeBoard("through-hole.kicad_pcb"), declaredPackage);

      // A THT part is soldered from the far side of the board. A package with copper, mask and no
      // paste is complete for this board, and demanding a stencil here is the finding this replaces.
      expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
    });

    it("treats a footprint with both SMD and drilled pads as surface-mount", async () => {
      const result = await run(await mountTypeBoard("mixed.kicad_pcb"), declaredPackage);

      // The connector carries a through-hole mounting pad and two SMD signal pads, so the side
      // does need paste even though it is not a pure SMD part.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.details).toMatchObject({ side: "top", smdFootprints: 1, smdReferences: ["J1"] });
    });

    it("keeps a side with an unknown mount type in scope without calling it proven", async () => {
      // A footprint whose pads are `connect` and which carries no `(attr ...)` states no mount
      // type, which is an absence of evidence rather than evidence of a through-hole part. Reading
      // it as "no paste needed" is the mistake.
      const result = await run(unknownMountTypeBoard, declaredPackage);

      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.message).toContain("unknown mount type on the top side");
      expect(findings[0]?.details).toMatchObject({
        side: "top",
        smdFootprints: 0,
        unknownMountTypeFootprints: 1,
        unknownMountTypeReferences: ["J1"],
      });
    });

    it("leaves a footprint whose side cannot be read to neither side", async () => {
      // SMD pads on an inner copper layer: the mount type is plain and the side is not, because
      // `In1.Cu` is neither `F.` nor `B.`. A side read that defaulted to one of the two would
      // invent an assembly side here, which is the semantics `manufacturing.assembly-sides` sets.
      const pcb = `(kicad_pcb
        (footprint "Resistor_SMD:R_0603_1608Metric" (layer "In1.Cu") (at 100 100)
          (property "Reference" "R1")
          (pad "1" smd roundrect (at -0.825 0) (size 0.8 0.95) (layers "In1.Cu" "In1.Paste"))
          (pad "2" smd roundrect (at 0.825 0) (size 0.8 0.95) (layers "In1.Cu" "In1.Paste"))
        )
      )`;
      const result = await run(pcb, declaredPackage);

      expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
    });

    it("does not require paste for a virtual footprint", async () => {
      const pcb = `(kicad_pcb (footprint "Lib:Logo" (layer "F.Cu") (at 1 1) (attr virtual) (property "Reference" "G1")))`;
      const result = await run(pcb, declaredPackage);

      // A footprint that declares itself virtual says what it is, and a graphic is not stenciled.
      expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
    });

    it("stays quiet for an unknown mount type whose side already has a declared paste layer", async () => {
      const result = await run(unknownMountTypeBoard, {
        ...declaredPackage,
        "fab/top-paste.gbr": layer("Paste,Top"),
      });

      expect(expectRule(result, "manufacturing.paste-coverage", 0)).toEqual([]);
    });

    it("reports the references behind the evidence in a stable order", async () => {
      const pcb = `(kicad_pcb
        (footprint "Lib:R_0805" (layer "F.Cu") (at 1 1) (attr smd) (property "Reference" "R2"))
        (footprint "Lib:R_0805" (layer "F.Cu") (at 3 1) (attr smd) (property "Reference" "R10"))
        (footprint "Lib:Resistor_THT" (layer "F.Cu") (at 5 1) (attr through_hole) (property "Reference" "J1"))
      )`;
      const result = await run(pcb, declaredPackage);

      // The references are read in board order, which is not a stable order for a report: the
      // same board has to produce the same finding twice for the evidence to be auditable.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.details).toMatchObject({
        side: "top",
        smdFootprints: 2,
        smdReferences: ["R10", "R2"],
        throughHoleFootprints: 1,
      });
    });
  });

  describe("whether a missing paste layer may block", () => {
    it("blocks on a package whose files each declare their own function", async () => {
      const result = await run(await mountTypeBoard("surface-mount.kicad_pcb"), declaredPackage, blockingConfig);

      // The absence is read from the files, so a configured blocking severity stands: nothing here
      // is an inference about a name.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.severity).toBe("high");
      expect(findings[0]?.confidence).toBe("high");
      expect(findings[0]?.details).toMatchObject({
        blocking: true,
        severity: "high",
        configuredSeverity: "high",
        severityCapped: false,
        layerIdentity: "declared",
        unidentifiedFiles: 0,
        assumedIdentityFiles: 0,
        pasteLayers: 0,
        pasteLayerFiles: [],
      });
      expect(String(findings[0]?.details?.rationale)).toMatch(/declares TF\.FileFunction/u);
    });

    it("refuses to block on a package identified by filename alone", async () => {
      const result = await run(
        await mountTypeBoard("surface-mount.kicad_pcb"),
        { "fab/board.gtl": plainLayer, "fab/board.gts": plainLayer, "fab/board.gko": plainLayer },
        blockingConfig,
      );

      // Pre-X2 output says nothing about itself, so the extensions are all there is -- and a
      // filename cannot prove a layer is absent. A configured `high` is capped rather than honoured,
      // and the cap is reported rather than applied quietly: the configured severity, a flag saying
      // it was lowered, a low confidence, and a message that does not assert the layer is absent.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.severity).toBe("low");
      expect(findings[0]?.confidence).toBe("low");
      expect(findings[0]?.message).toContain("no top solder paste layer could be established");
      expect(findings[0]?.message).not.toContain("lacks a top solder paste");
      expect(findings[0]?.details).toMatchObject({
        blocking: false,
        severity: "low",
        configuredSeverity: "high",
        severityCapped: true,
        layerIdentity: "assumed",
      });
      expect(String(findings[0]?.details?.rationale)).toMatch(/filename cannot prove that a layer is absent/u);
    });

    it("refuses to block on a declared package carrying one file identified by filename alone", async () => {
      const result = await run(
        await mountTypeBoard("surface-mount.kicad_pcb"),
        { ...declaredPackage, "fab/board.gm1": plainLayer },
        blockingConfig,
      );

      // Every artwork file here declares itself, and the one file that does not is a mechanical
      // layer named by extension. The question an absence has to survive is "could this be the
      // stencil under a name I did not recognise", and a filename does not settle it -- so a
      // package carrying one un-declared mechanical layer stays advisory. The conservative answer
      // is the intended one: this rule never blocks on a name.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.details).toMatchObject({
        blocking: false,
        severityCapped: true,
        layerIdentity: "assumed",
        unidentifiedFiles: 0,
        assumedIdentityFiles: 1,
      });
      expect(String(findings[0]?.details?.rationale)).toMatch(/identified by filename alone/u);
    });

    it("refuses to block when a file in the package is not a layer this reader can identify", async () => {
      const result = await run(await mountTypeBoard("surface-mount.kicad_pcb"), {
        ...declaredPackage,
        "fab/extra.gbr": plainLayer,
      });

      // The file is named `.gbr` and declares nothing, so it could be the stencil under a name this
      // reader does not recognise. An absence that has to survive that possibility is advisory, and
      // it is reported as its own state: a file this reader could not place at all is a different
      // thing to go and look at from one it placed by name.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.details).toMatchObject({
        blocking: false,
        severity: "low",
        layerIdentity: "unidentified",
        unidentifiedFiles: 1,
      });
      expect(String(findings[0]?.details?.rationale)).toMatch(/may be the missing stencil/u);
    });

    it("refuses to block on a side whose need for a stencil rests on an unknown mount type", async () => {
      const result = await run(unknownMountTypeBoard, declaredPackage, blockingConfig);

      // The package here is entirely self-declared, so the layer really is absent. What is not
      // proven is that this side needs one, and a finding cannot block on the unproven half alone.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.severity).toBe("low");
      expect(findings[0]?.details).toMatchObject({ blocking: false, layerIdentity: "declared" });
      expect(String(findings[0]?.details?.rationale)).toMatch(/needs a stencil is unproven/u);
    });

    it("names the other side's declared paste layer while the package stays unproven", async () => {
      const result = await run(
        await mountTypeBoard("mixed.kicad_pcb"),
        { ...declaredPackage, "fab/bottom-paste.gbr": layer("Paste,Bot"), "fab/extra.gbr": plainLayer },
        blockingConfig,
      );

      // Both halves at once: the bottom side's declared stencil is reported as the evidence that
      // is there, and the one file that cannot be placed keeps the whole package short of proof --
      // so a package missing one stencil under a file this reader cannot name never blocks.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.severity).toBe("low");
      expect(findings[0]?.details).toMatchObject({
        side: "top",
        blocking: false,
        layerIdentity: "unidentified",
        unidentifiedFiles: 1,
        pasteLayers: 1,
        pasteLayerFiles: ["fab/bottom-paste.gbr"],
      });
    });

    it("reports the paste layers the package does carry as the other half of the evidence", async () => {
      const result = await run(await mountTypeBoard("mixed.kicad_pcb"), {
        ...declaredPackage,
        "fab/bottom-paste.gbr": layer("Paste,Bot"),
      });

      // The top side is still short a stencil and the bottom one is not, so the finding names the
      // layer that is there rather than only counting the ones that are not.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.details).toMatchObject({
        side: "top",
        pasteLayers: 1,
        pasteLayerFiles: ["fab/bottom-paste.gbr"],
      });
    });

    it("spells the paste-layer evidence the same way the finding's own path is spelled", async () => {
      const result = await run(await mountTypeBoard("mixed.kicad_pcb"), {
        ...declaredPackage,
        "fab/bottom-paste.gbr": layer("Paste,Bot"),
      });

      // This rule's evidence is report text a reader has to be able to match against a file. It
      // used to carry whatever separator the run platform produced -- `fab\bottom-paste.gbr` on
      // Windows -- while `resource.path` stayed slash-normalized, so one finding named the same
      // file two ways. Stating the invariant here guards the run platform this assertion is
      // checked on, whatever the pipeline hands the stackup.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      const evidence = findings[0]?.details?.pasteLayerFiles as string[];
      expect(evidence).toEqual(["fab/bottom-paste.gbr"]);
      expect(evidence.join(" ")).not.toContain("\\");
    });

    it("does not report a cap on a severity the cap did not lower", async () => {
      const result = await run(
        await mountTypeBoard("surface-mount.kicad_pcb"),
        { "fab/board.gtl": plainLayer, "fab/board.gts": plainLayer, "fab/board.gko": plainLayer },
        advisoryConfig,
      );

      // `low` is the floor the cap enforces, so a project already configured at it has nothing
      // lowered. Saying `severityCapped` here would report an override that did not happen, which
      // is the same false statement in the other direction.
      const findings = expectRule(result, "manufacturing.paste-coverage", 1);
      expect(findings[0]?.severity).toBe("low");
      expect(findings[0]?.confidence).toBe("low");
      expect(findings[0]?.details).toMatchObject({
        blocking: false,
        severity: "low",
        configuredSeverity: "low",
        severityCapped: false,
        layerIdentity: "assumed",
      });
    });
  });
});
