import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { expectRule, runFixture, writeFixture } from "../helpers.js";

describe("manufacturing.package-completeness", () => {
  it("reports missing categories in a project with partial outputs", async () => {
    const result = await runFixture("package-completeness-missing");
    const findings = result.findings.filter((f) => f.ruleId === "manufacturing.package-completeness");
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const missingIds = findings.map((f) => (f.details as { missingCategory: string }).missingCategory);
    expect(missingIds).toContain("drill");
    expect(missingIds).toContain("bom");
    // Each finding has a valid fix description
    for (const f of findings) {
      expect(f.fix?.description).toBeTruthy();
    }
  });

  it("passes when all base categories are present", async () => {
    const result = await runFixture("package-completeness-pass");
    expectRule(result, "manufacturing.package-completeness", 0);
  });

  it("includes completeness score and category breakdown in finding details", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      // Only provide gerbers — missing drill, drill-report, bom, cpl
      "gerbers/board.gtl": "gerber",
    });
    const result = await runPipeline({
      path: root,
      rules: ["manufacturing.package-completeness"],
      failOn: "never",
    });
    const findings = result.findings.filter((f) => f.ruleId === "manufacturing.package-completeness");
    expect(findings.length).toBeGreaterThan(0);
    const details = findings[0]?.details as {
      completenessScore: number;
      presentCategories: string[];
      missingCategories: string[];
    };
    expect(typeof details.completenessScore).toBe("number");
    expect(details.completenessScore).toBeGreaterThanOrEqual(0);
    expect(details.completenessScore).toBeLessThanOrEqual(100);
    expect(details.presentCategories).toContain("gerbers");
    expect(details.missingCategories.length).toBeGreaterThan(0);
  });

  it("adds production categories in production release mode", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "gerbers/board.gtl": "gerber",
      "gerbers/board.drl": "drill",
      "gerbers/board-drill-report.txt": "drill report",
      "assembly/bom.csv": "Reference,MPN\nR1,ABC\n",
      "assembly/positions.csv": "Designator,Mid X\nR1,1\n",
    });
    const result = await runPipeline({
      path: root,
      rules: ["manufacturing.package-completeness"],
      failOn: "never",
      releaseMode: "production",
    });
    const findings = result.findings.filter((f) => f.ruleId === "manufacturing.package-completeness");
    const missingIds = findings.map((f) => (f.details as { missingCategory: string }).missingCategory);
    // Production mode should detect missing fab-notes, assembly-notes, board-pdf
    expect(missingIds).toContain("fab-notes");
  });

  it("does not add production categories in prototype mode", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "gerbers/board.gtl": "gerber",
      "gerbers/board.drl": "drill",
      "gerbers/board-drill-report.txt": "drill report",
      "assembly/bom.csv": "Reference,MPN\nR1,ABC\n",
      "assembly/positions.csv": "Designator,Mid X\nR1,1\n",
    });
    const result = await runPipeline({
      path: root,
      rules: ["manufacturing.package-completeness"],
      failOn: "never",
      releaseMode: "prototype",
    });
    const findings = result.findings.filter((f) => f.ruleId === "manufacturing.package-completeness");
    // No production-only checks in prototype mode → all base categories present → no findings
    expect(findings).toHaveLength(0);
  });
});
