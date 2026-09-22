import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFinding } from "../../../src/core/findings.js";
import {
  gateRequirementFindings,
  requiredGateRules,
  requiredManufacturingOutputs,
} from "../../../src/core/gates/requirements.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import { writeFixture } from "../rules/helpers.js";

describe("gate requirements", () => {
  it("maps rule findings into gate requirement findings", () => {
    const findings = gateRequirementFindings(
      [
        createFinding({
          ruleId: "drc.kicad.clearance",
          severity: "medium",
          message: "clearance",
          resource: { path: "board.kicad_pcb", kind: "pcb" },
        }),
        createFinding({
          ruleId: "manufacturing.outputs-present",
          severity: "high",
          message: "drill output missing",
          resource: { path: ".", kind: "manifest" },
          details: { required: "drill" },
        }),
        createFinding({
          ruleId: "bom.eol-detection",
          severity: "high",
          message: "component is EOL",
          resource: { path: "bom.csv", kind: "bom" },
        }),
        createFinding({
          ruleId: "erc.kicad.net",
          severity: "high",
          message: "erc finding",
          resource: { path: "board.kicad_sch", kind: "schematic" },
        }),
        createFinding({
          ruleId: "release.changelog-present",
          severity: "high",
          message: "changelog missing",
          resource: { path: "CHANGELOG.md", kind: "manifest" },
        }),
        createFinding({
          ruleId: "release.tag-matches-revision",
          severity: "high",
          message: "tag mismatch",
          resource: { path: ".", kind: "manifest" },
        }),
      ],
      ["clean-drc", "clean-erc", "drill", "changelog", "tagged-release", "no-eol-components", "unknown"],
    );

    expect(findings.map((finding) => finding.details?.requirement)).toEqual([
      "clean-drc",
      "clean-erc",
      "drill",
      "changelog",
      "tagged-release",
      "no-eol-components",
    ]);
    expect(findings.every((finding) => finding.ruleId === "gate.requirement")).toBe(true);
    expect(findings.every((finding) => finding.severity === "critical")).toBe(true);
  });

  it("injects gate manufacturing outputs and fails required outputs end-to-end", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": `version: 1
gates:
  release:
    fail-on: critical
    require: [gerber]
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  manufacturing.outputs-present:
    required: [drill]
  release.changelog-present:
    enabled: false
`,
    });

    const result = await runPipeline({
      path: root,
      gate: "release",
      rules: ["manufacturing.outputs-present"],
    });

    expect(requiredManufacturingOutputs(["gerber", "clean-drc", "bom"])).toEqual(["gerber", "bom"]);
    expect(
      result.findings
        .filter((finding) => finding.ruleId === "manufacturing.outputs-present")
        .map((finding) => finding.details?.required),
    ).toEqual(["drill", "gerber"]);
    expect(result.findings.some((finding) => finding.details?.requirement === "gerber")).toBe(true);
    expect(result.summary.failed).toBe(true);
  });

  it("runs gate-required rules despite config and CLI filters", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": `version: 1
gates:
  release:
    fail-on: critical
    require: [gerber]
rules:
  manufacturing.outputs-present:
    enabled: false
`,
    });

    const result = await runPipeline({
      path: root,
      gate: "release",
      rules: ["release.revision-set"],
      skips: ["manufacturing.outputs-present"],
    });

    expect(
      requiredGateRules(["clean-drc", "clean-erc", "gerber", "changelog", "tagged-release", "no-eol-components"]),
    ).toEqual([
      "drc.kicad",
      "erc.kicad",
      "manufacturing.outputs-present",
      "release.changelog-present",
      "release.tag-matches-revision",
      "bom.eol-detection",
    ]);
    expect(result.findings.map((finding) => finding.ruleId)).toContain("manufacturing.outputs-present");
    expect(result.findings.some((finding) => finding.details?.requirement === "gerber")).toBe(true);
  });

  it("reports an explicitly selected gate that is not configured", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": "version: 1\n",
    });

    const result = await runPipeline({
      path: root,
      gate: "release",
      rules: ["release.revision-set"],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "config.invalid",
          message: expect.stringContaining('Gate "release" not found in configuration.'),
        }),
      ]),
    );
  });

  it("fails an explicitly selected unknown gate regardless of fail-on threshold", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": "version: 1\n",
    });

    const result = await runPipeline({
      path: root,
      gate: "release",
      failOn: "never",
      rules: ["release.revision-set"],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "config.invalid",
          severity: "critical",
          message: expect.stringContaining('Gate "release" not found in configuration.'),
        }),
      ]),
    );
    expect(result.summary.failed).toBe(true);
  });

  it("keeps an auto-detected missing gate on legacy config semantics", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": "version: 1\n",
    });

    const result = await runPipeline({
      path: root,
      gate: "main",
      gateAutoDetected: true,
      rules: ["release.revision-set"],
    });

    expect(result.findings.map((finding) => finding.ruleId)).not.toContain("config.invalid");
  });

  it("injects output requirements without an existing manufacturing output rule config", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": `version: 1
gates:
  release:
    fail-on: critical
    require: [position]
`,
    });

    const result = await runPipeline({
      path: root,
      gate: "release",
      rules: ["manufacturing.outputs-present"],
    });

    expect(result.findings.map((finding) => finding.details?.required)).toContain("position");
  });

  it("runs non-output required rules without injecting manufacturing outputs", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": `version: 1
gates:
  main:
    fail-on: high
    require: [clean-drc]
rules:
  drc.kicad:
    enabled: false
`,
    });

    const result = await runPipeline({
      path: root,
      gate: "main",
      kicadCli: "__test_unavailable__",
      rules: ["manufacturing.outputs-present"],
    });

    expect(result.findings.map((finding) => finding.ruleId)).not.toContain("manufacturing.outputs-present");
    expect(result.findings.some((finding) => finding.details?.requirement === "clean-drc")).toBe(true);
  });

  it("fails clean-drc requirements when no PCB files are checked", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "boardreadyops.yml": `version: 1
gates:
  release:
    fail-on: critical
    require: [clean-drc]
rules:
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
  release.revision-set:
    enabled: false
`,
    });
    const kicadCli = await writeExecutable(root, "kicad-cli", [
      `if (args[0] === "version") {`,
      `  process.stdout.write("10.0.2\\n");`,
      `  process.exit(0);`,
      `}`,
      `process.exit(9);`,
    ]);

    const result = await runPipeline({
      path: root,
      gate: "release",
      kicadCli,
      rules: ["drc.kicad"],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "gate.requirement",
          severity: "critical",
          details: expect.objectContaining({
            requirement: "clean-drc",
            reason: "no PCB files were checked",
          }),
        }),
      ]),
    );
    expect(result.summary.failed).toBe(true);
  });

  it("fails clean-erc requirements when no schematic files are checked", () => {
    const findings = gateRequirementFindings(
      [],
      ["clean-erc"],
      [
        {
          projectFile: "board.kicad_pro",
          root: ".",
          schematicFiles: [],
          boardFiles: ["board.kicad_pcb"],
          jobsetFiles: [],
        },
      ],
    );

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "gate.requirement",
        severity: "critical",
        details: expect.objectContaining({
          requirement: "clean-erc",
          blockedBy: [],
          reason: "no schematic files were checked",
        }),
      }),
    ]);
  });

  it("does not fail clean target requirements when project context is unavailable or target files exist", () => {
    expect(gateRequirementFindings([], ["clean-drc"])).toEqual([]);
    expect(
      gateRequirementFindings(
        [],
        ["clean-drc"],
        [
          {
            projectFile: "board.kicad_pro",
            root: ".",
            schematicFiles: ["board.kicad_sch"],
            boardFiles: ["board.kicad_pcb"],
            jobsetFiles: [],
          },
        ],
      ),
    ).toEqual([]);
  });
});

async function writeExecutable(root: string, basename: string, bodyLines: string[]): Promise<string> {
  const js = path.join(root, `${basename}.mjs`);
  const script = path.join(root, process.platform === "win32" ? `${basename}.cmd` : basename);
  await fs.writeFile(js, `const args = process.argv.slice(2);\n${bodyLines.join("\n")}\n`, "utf8");
  if (process.platform === "win32") {
    await fs.writeFile(script, `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`, "utf8");
  } else {
    await fs.writeFile(script, `#!/bin/sh\n"${process.execPath}" "${js}" "$@"\n`, "utf8");
    await fs.chmod(script, 0o755);
  }
  return script;
}
