import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../src/core/pipeline.js";
import { writeFixture } from "../rules/helpers.js";

const selected = {
  "hardware/demo/demo.kicad_pro": "{}",
  "hardware/demo/demo.kicad_sch": "(kicad_sch)",
  "hardware/demo/demo.kicad_pcb": '(kicad_pcb (footprint "Lib:R" (layer "F.Cu") (at 1 1) (property "Reference" "R1")))',
};
const selectedProject = "hardware/demo/demo.kicad_pro";
const layer = (functionId: string) =>
  ["%FSLAX36Y36*%", "%MOMM*%", `%TF.FileFunction,${functionId}*%`, "D10*", "X1000000Y1000000D03*", "M02*"].join("\n");

const rules = [
  "release.artifact-provenance",
  "manufacturing.mask-coverage",
  "manufacturing.board-edge-clearance",
  "manufacturing.paste-coverage",
  "manufacturing.drill-coverage",
];

describe("manufacturing evidence belongs to the selected KiCad project", () => {
  it("does not assign unrelated repository test fixture Gerbers to a selected nested project", async () => {
    const root = await writeFixture({
      ...selected,
      "tests/fixtures/unrelated/fab/top.gtl": layer("Copper,L1,Top"),
      "tests/fixtures/unrelated/fab/bottom.gbl": layer("Copper,L2,Bot"),
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules,
      failOn: "never",
    });
    expect(result.projects.map((project) => project.projectFile)).toEqual([selectedProject]);
    expect(result.findings.filter((finding) => rules.includes(finding.ruleId))).toEqual([]);
  });

  it("still reports missing mask and provenance for the selected project's own Gerbers", async () => {
    const root = await writeFixture({
      ...selected,
      "hardware/demo/fab/top.gtl": layer("Copper,L1,Top"),
      "hardware/demo/fab/bottom.gbl": layer("Copper,L2,Bot"),
      "tests/fixtures/unrelated/fab/top.gts": layer("Soldermask,Top"),
      "tests/fixtures/unrelated/fab/bottom.gbs": layer("Soldermask,Bot"),
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules,
      failOn: "never",
    });
    const provenance = result.findings.filter((finding) => finding.ruleId === "release.artifact-provenance");
    const mask = result.findings.filter((finding) => finding.ruleId === "manufacturing.mask-coverage");
    expect(provenance).toHaveLength(1);
    expect(mask.map((finding) => finding.details?.side).sort()).toEqual(["bottom", "top"]);
    for (const finding of result.findings.filter((entry) => rules.includes(entry.ruleId))) {
      expect(finding.resource.path).toMatch(/^hardware\/demo\//u);
    }
  });

  it("does not count another project's Gerbers as satisfying required package outputs", async () => {
    const root = await writeFixture({
      ...selected,
      "boardreadyops.yml": [
        "version: 1",
        "rules:",
        "  manufacturing.outputs-present:",
        "    enabled: true",
        "    required: [gerber]",
        "fail-on: never",
      ].join("\n"),
      "tests/fixtures/unrelated/fab/top.gtl": layer("Copper,L1,Top"),
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules: ["manufacturing.outputs-present", "manufacturing.package-completeness"],
      releaseMode: "production",
      failOn: "never",
    });
    expect(
      result.findings.some(
        (finding) => finding.ruleId === "manufacturing.outputs-present" && finding.message.includes("missing"),
      ),
    ).toBe(true);
    expect(
      result.findings.some(
        (finding) =>
          finding.ruleId === "manufacturing.package-completeness" && finding.details?.missingCategory === "gerbers",
      ),
    ).toBe(true);
  });
  it("still recognizes repository-relative manufacturing files explicitly configured for a project", async () => {
    const root = await writeFixture({
      ...selected,
      "boardreadyops.yml": [
        "version: 1",
        "rules:",
        "  manufacturing.outputs-present:",
        "    enabled: true",
        "    required: [gerber]",
        "    patterns:",
        "      gerber: ['**/shared-fab/*.gtl']",
        "fail-on: never",
      ].join("\n"),
      "shared-fab/source.gtl": layer("Copper,L1,Top"),
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules: ["manufacturing.outputs-present"],
      failOn: "never",
    });
    expect(result.findings.filter((finding) => finding.ruleId === "manufacturing.outputs-present")).toEqual([]);
  });

  it("does not attribute the repository's own unrelated KiCad fixture Gerbers to golden demo", async () => {
    const result = await runPipeline({
      path: process.cwd(),
      project: "examples/golden-demo/fixed/demo.kicad_pro",
      rules,
      failOn: "never",
    });
    expect(result.projects.map((project) => project.projectFile)).toEqual([
      "examples/golden-demo/fixed/demo.kicad_pro",
    ]);
    expect(result.findings.filter((finding) => rules.includes(finding.ruleId))).toEqual([]);
  });
  it("does not use an unrelated board's auto-discovered BOM for the selected project", async () => {
    const root = await writeFixture({
      ...selected,
      "hardware/broken/bom.csv": "Reference,MPN,Manufacturer\nR99,,OtherBrand\n",
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules: ["bom.missing-mpn", "bom.risk-score"],
      failOn: "never",
    });
    expect(result.findings.filter((finding) => finding.ruleId.startsWith("bom."))).toEqual([]);
    expect(result.fabrication.bom).toEqual([]);
    expect(result.fabrication.outputs.find((output) => output.kind === "bom")?.files).toEqual([]);
    expect(result.boms?.map((bom) => ({ project: bom.project, components: bom.components }))).toEqual([
      { project: selectedProject, components: [] },
    ]);
  });

  it("selects only the nested project's local BOM for rules and fabrication evidence", async () => {
    const root = await writeFixture({
      ...selected,
      "hardware/aaa-broken/bom.csv": "Reference,MPN,Manufacturer\nR99,,OtherBrand\n",
      "hardware/demo/bom.csv": "Reference,MPN,Manufacturer\nR1,RC0603FR,Yageo\n",
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules: ["bom.missing-mpn", "bom.risk-score"],
      failOn: "never",
    });
    expect(result.findings.filter((finding) => finding.ruleId.startsWith("bom."))).toEqual([]);
    expect(result.fabrication.bom.map((row) => row.reference)).toEqual(["R1"]);
    expect(result.fabrication.outputs.find((output) => output.kind === "bom")?.files.map((file) => file.path)).toEqual([
      "hardware/demo/bom.csv",
    ]);
  });

  it("keeps an explicitly selected cross-folder BOM instead of silently excluding it", async () => {
    const root = await writeFixture({
      ...selected,
      "shared/authorized-bom.csv": "Reference,MPN\nR99,\n",
      "hardware/broken/bom.csv": "Reference,MPN\nR100,\n",
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      bom: "shared/authorized-bom.csv",
      rules: ["bom.missing-mpn"],
      failOn: "never",
    });
    const finding = result.findings.find((entry) => entry.ruleId === "bom.missing-mpn");
    expect(finding?.resource.path).toBe("shared/authorized-bom.csv");
    expect(finding?.details?.reference).toBe("R99");
    expect(result.fabrication.bom.map((row) => row.reference)).toEqual(["R99"]);
  });

  it("does not collect another configured board's BOM into the selected project's fabrication snapshot", async () => {
    const root = await writeFixture({
      ...selected,
      "hardware/broken/broken.kicad_pro": "{}",
      "hardware/broken/broken.kicad_sch": "(kicad_sch)",
      "hardware/broken/broken.kicad_pcb": "(kicad_pcb)",
      "shared/selected.csv": "Reference,MPN\nR1,RC0603FR\n",
      "shared/other.csv": "Reference,MPN\nR99,\n",
      "boardreadyops.yml": [
        "version: 1",
        "projects:",
        "  - path: hardware/demo",
        "    bom: shared/selected.csv",
        "  - path: hardware/broken",
        "    bom: shared/other.csv",
        "fail-on: never",
      ].join("\n"),
    });
    const result = await runPipeline({
      path: root,
      project: selectedProject,
      rules: ["bom.missing-mpn"],
      failOn: "never",
    });
    expect(result.findings.filter((finding) => finding.ruleId === "bom.missing-mpn")).toEqual([]);
    expect(result.fabrication.bom.map((row) => row.reference)).toEqual(["R1"]);
    expect(result.fabrication.outputs.find((output) => output.kind === "bom")?.files.map((file) => file.path)).toEqual([
      "shared/selected.csv",
    ]);
  });
});
