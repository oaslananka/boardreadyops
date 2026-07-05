import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConcurrency, mapLimit } from "../../src/core/concurrency.js";
import { loadConfig, validateConfig } from "../../src/core/config.js";
import { discoverProjects } from "../../src/core/discovery.js";
import {
  createFinding,
  isSeverity,
  severityRankValue,
  shouldFail,
  sortFindings,
  summarizeFindings,
} from "../../src/core/findings.js";
import { runPipeline } from "../../src/core/pipeline.js";
import { formatJson } from "../../src/report/json.js";
import { formatMarkdown } from "../../src/report/markdown.js";
import { formatSarif } from "../../src/report/sarif.js";

const fixtureRoot = path.resolve("tests/fixtures/projects");

describe("configuration", () => {
  it("validates the versioned config schema", () => {
    expect(validateConfig({ version: 1, failOn: "high" })).not.toEqual([]);
    expect(validateConfig({ version: 1, "fail-on": "high" })).toEqual([]);
    expect(
      validateConfig({
        version: 1,
        gates: {
          release: {
            "fail-on": "medium",
            require: ["clean-drc", "gerber", "tagged-release"],
          },
        },
        suppressions: [
          {
            rule: "manufacturing.outputs-present",
            project: "hardware/prototype",
            reason: "prototype outputs are not published",
            expires: "2026-10-01",
            refs: ["U3"],
            fingerprint: "a".repeat(64),
          },
        ],
        baseline: { file: ".boardreadyops-baseline.json", mode: "new-only" },
        fix: { allow: ["bom.missing-mpn", "release.version-format"] },
      }),
    ).toEqual([]);
    expect(validateConfig({ version: 1, gates: { release: { require: ["unknown"] } } })).not.toEqual([]);
    expect(
      validateConfig({
        version: 1,
        suppressions: [{ rule: "bom.lifecycle", reason: "ref suppression requires refs", refs: [] }],
      }),
    ).not.toEqual([]);
    expect(validateConfig({ version: 1, report: { junit: "build/boardreadyops.junit.xml" } })).toEqual([]);
    expect(validateConfig({ version: 2 }).join("\n")).toContain("must be equal to constant");
  });

  it("loads accepted config filenames", async () => {
    const loaded = await loadConfig(path.join(fixtureRoot, "safe-basic"));
    expect(loaded.errors).toEqual([]);
    expect(loaded.path?.endsWith("boardreadyops.yml")).toBe(true);
  });

  it("does not read baseline files when all findings remain active", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-baseline-all-"));
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      "version: 1\nbaseline:\n  file: .boardreadyops-baseline.json\n  mode: all\n",
      "utf8",
    );
    await fs.writeFile(path.join(root, ".boardreadyops-baseline.json"), "null\n", "utf8");

    await expect(runPipeline({ path: root, failOn: "never", rules: ["not.a.rule"] })).resolves.toMatchObject({
      summary: { total: 1 },
    });
  });
});

describe("discovery and findings", () => {
  it("discovers KiCad projects", async () => {
    const projects = await discoverProjects(path.join(fixtureRoot, "safe-basic"));
    expect(projects).toHaveLength(1);
    expect(projects[0]?.schematicFiles).toEqual(["safe-basic.kicad_sch"]);
    expect(projects[0]?.boardFiles).toEqual(["safe-basic.kicad_pcb"]);
  });

  it("summarizes and thresholds findings", () => {
    const finding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "missing",
      resource: { path: "bom.csv", kind: "bom" },
    });
    expect(finding.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(shouldFail([finding], "high")).toBe(true);
    expect(shouldFail([finding], "critical")).toBe(false);
    expect(summarizeFindings([finding], "high")).toMatchObject({ total: 1, high: 1, failed: true });
  });

  it("recognizes severities and sorts findings deterministically", () => {
    expect(isSeverity("critical")).toBe(true);
    expect(isSeverity("none")).toBe(false);
    expect(severityRankValue("critical")).toBeGreaterThan(severityRankValue("high"));

    const findings = [
      createFinding({
        ruleId: "z.rule",
        severity: "medium",
        message: "later",
        project: "beta",
        resource: { path: "z.kicad_pcb", kind: "pcb" },
      }),
      createFinding({
        ruleId: "a.rule",
        severity: "critical",
        message: "first",
        project: "alpha",
        resource: { path: "a.kicad_pcb", kind: "pcb" },
      }),
      createFinding({
        ruleId: "a.rule",
        severity: "medium",
        message: "same severity sorts by project",
        project: "alpha",
        resource: { path: "b.kicad_pcb", kind: "pcb" },
      }),
      createFinding({
        ruleId: "a.rule",
        severity: "medium",
        message: "same severity sorts by path",
        project: "alpha",
        resource: { path: "a.kicad_pcb", kind: "pcb" },
      }),
    ];

    expect(
      sortFindings(findings).map((finding) => [
        finding.severity,
        finding.ruleId,
        finding.project,
        finding.resource.path,
      ]),
    ).toEqual([
      ["critical", "a.rule", "alpha", "a.kicad_pcb"],
      ["medium", "a.rule", "alpha", "a.kicad_pcb"],
      ["medium", "a.rule", "alpha", "b.kicad_pcb"],
      ["medium", "z.rule", "beta", "z.kicad_pcb"],
    ]);
    expect(summarizeFindings(findings, "medium")).toMatchObject({
      total: 4,
      critical: 1,
      medium: 3,
      maxSeverity: "critical",
      failed: true,
    });
  });

  it("keeps project, fix, and confidence metadata on findings", () => {
    const finding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "missing",
      project: "assembly/main.kicad_pro",
      resource: { path: "bom.csv", kind: "bom" },
      fix: {
        description: "Add manufacturer part numbers before fabrication.",
        steps: ["Populate the MPN column.", "Re-run the BOM check."],
        references: ["https://example.test/mpn"],
        automated: false,
      },
      confidence: "definite",
    });

    expect(finding).toMatchObject({
      project: "assembly/main.kicad_pro",
      fix: {
        description: "Add manufacturer part numbers before fabrication.",
        steps: ["Populate the MPN column.", "Re-run the BOM check."],
      },
      confidence: "definite",
    });
  });

  it("runs bounded concurrency helpers", async () => {
    expect(defaultConcurrency()).toBeGreaterThanOrEqual(1);
    const values = await mapLimit([1, 2, 3], 2, async (value) => value * 2);
    expect(values).toEqual([2, 4, 6]);
    expect(await mapLimit([], 0, async (value) => value)).toEqual([]);
  });

  it("reports missing project shapes before rule results", async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-empty-"));
    const empty = await runPipeline({ path: emptyRoot, failOn: "never", rules: ["release.revision-set"] });
    expect(empty.findings.map((finding) => finding.message)).toContain("No .kicad_pro project was found.");

    const missingSchematic = await runPipeline({
      path: path.join(fixtureRoot, "missing-schematic"),
      failOn: "never",
      rules: ["release.revision-set"],
    });
    expect(missingSchematic.findings.some((finding) => finding.message.includes("no matching schematic file"))).toBe(
      true,
    );

    const missingBoard = await runPipeline({
      path: path.join(fixtureRoot, "missing-board"),
      failOn: "never",
      rules: ["release.revision-set"],
    });
    expect(missingBoard.findings.some((finding) => finding.message.includes("no matching board file"))).toBe(true);
  });
});

describe("reporting", () => {
  it("emits JSON, Markdown, and SARIF", async () => {
    const result = await runPipeline({ path: path.join(fixtureRoot, "safe-basic"), failOn: "high" });
    expect(result.summary.total).toBe(0);
    expect(JSON.parse(formatJson(result)).tool.name).toBe("boardreadyops");
    expect(formatMarkdown(result)).toContain("No findings.");
    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].tool.driver.name).toBe("BoardReadyOps");
  });

  it("captures fabrication snapshot data for JSON artifacts", async () => {
    const result = (await runPipeline({
      path: path.join(fixtureRoot, "bom-single-source"),
      failOn: "never",
    })) as Awaited<ReturnType<typeof runPipeline>> & {
      fabrication?: {
        bom: Array<{ reference: string }>;
        outputs: Array<{ kind: string }>;
      };
    };

    expect(result.fabrication?.bom.map((row) => row.reference)).toContain("R1");
    expect(result.fabrication?.outputs.map((output) => output.kind)).toContain("bom");
  });

  it("propagates releaseMode from pipeline options to run result", async () => {
    const result = await runPipeline({
      path: path.join(fixtureRoot, "safe-basic"),
      failOn: "never",
      releaseMode: "production",
    });
    expect(result.releaseMode).toBe("production");
    expect(JSON.parse(formatJson(result)).releaseMode).toBe("production");
  });

  it("includes releaseMode in JSON output and omits it when not set", async () => {
    const withMode = await runPipeline({
      path: path.join(fixtureRoot, "safe-basic"),
      failOn: "never",
      releaseMode: "prototype",
    });
    expect(JSON.parse(formatJson(withMode)).releaseMode).toBe("prototype");

    const withoutMode = await runPipeline({
      path: path.join(fixtureRoot, "safe-basic"),
      failOn: "never",
    });
    expect(JSON.parse(formatJson(withoutMode)).releaseMode).toBeUndefined();
  });
});
