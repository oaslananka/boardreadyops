import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import findingsSchema from "../../../schemas/findings.schema.json" with { type: "json" };
import { createFinding, summarizeFindings } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";
import { formatJson } from "../../../src/report/json.js";
import { formatJunit } from "../../../src/report/junit.js";
import { formatMarkdown, stickyMarker } from "../../../src/report/markdown.js";
import { formatSarif } from "../../../src/report/sarif.js";

describe("report formats", () => {
  it("validates JSON output against the findings schema", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(findingsSchema);
    const payload = JSON.parse(formatJson(sampleResult()));
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
  });

  it("emits SARIF 2.1.0 matching the local SARIF structural schema", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(sarifSchema);
    const payload = JSON.parse(formatSarif(sampleResult()));
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
    expect(payload.runs[0].results[0].partialFingerprints.primaryLocationLineHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.runs[0].tool.driver.rules[0].help.text).toContain("Add manufacturer part numbers.");
    expect(payload.runs[0].tool.driver.rules[0].help.markdown).toContain("1. Populate the MPN column.");
  });

  it("keeps SARIF fix help readable when no steps are provided", () => {
    const payload = JSON.parse(
      formatSarif(
        sampleResult([
          createFinding({
            ruleId: "bom.single-source",
            severity: "medium",
            message: "R1 has one source.",
            resource: { path: "bom.csv", kind: "bom" },
            fix: { description: "Add an alternate approved source." },
          }),
        ]),
      ),
    );

    expect(payload.runs[0].tool.driver.rules[0].help).toEqual({
      text: "Add an alternate approved source.",
      markdown: "Add an alternate approved source.",
    });
  });

  it("keeps per-finding SARIF fix metadata for repeated rule ids", () => {
    const payload = JSON.parse(
      formatSarif(
        sampleResult([
          createFinding({
            ruleId: "manifest.project-discovery",
            severity: "high",
            message: "Project has no schematic.",
            resource: { path: "main.kicad_pro", kind: "project" },
            fix: { description: "Add a matching schematic file." },
          }),
          createFinding({
            ruleId: "manifest.project-discovery",
            severity: "high",
            message: "Project has no board.",
            resource: { path: "main.kicad_pro", kind: "project" },
            fix: { description: "Add a matching board file." },
          }),
        ]),
      ),
    );

    expect(payload.runs[0].tool.driver.rules).toHaveLength(1);
    expect(
      payload.runs[0].results.map(
        (result: { properties: { fix?: { description: string } } }) => result.properties.fix?.description,
      ),
    ).toEqual(["Add a matching schematic file.", "Add a matching board file."]);
  });

  it("maps board coordinates to SARIF logical locations with finding context", () => {
    const payload = JSON.parse(
      formatSarif(
        sampleResult([
          createFinding({
            ruleId: "design.board-outline",
            severity: "critical",
            message: "Board outline has a gap.",
            project: "hardware/main.kicad_pro",
            resource: { path: "hardware/main.kicad_pcb", kind: "pcb" },
            location: {
              region: {
                startLine: 42,
                endLine: 44,
                startColumn: 3,
                endColumn: 12,
              },
              boardCoordinates: {
                x: 14.2,
                y: 8.7,
                layer: "Edge.Cuts",
                units: "mm",
              },
            },
            fix: {
              description: "Close the outline segment.",
              steps: ["Open Edge.Cuts.", "Connect the adjacent outline endpoints."],
            },
            confidence: "definite",
          }),
        ]),
      ),
    );

    const result = payload.runs[0].results[0];
    expect(result.locations[0].physicalLocation).toEqual({
      artifactLocation: {
        uri: "hardware/main.kicad_pcb",
      },
      region: {
        startLine: 42,
        endLine: 44,
        startColumn: 3,
        endColumn: 12,
      },
    });
    expect(result.locations[0].logicalLocations).toEqual([
      {
        name: "Edge.Cuts @ (14.2mm, 8.7mm)",
        kind: "member",
        fullyQualifiedName: "pcb:Edge.Cuts:14.2mm,8.7mm",
      },
    ]);
    expect(result.properties).toMatchObject({
      severity: "critical",
      project: "hardware/main.kicad_pro",
      resourceKind: "pcb",
      confidence: "definite",
    });
    expect(payload.runs[0].tool.driver.rules[0].help.text).toContain("Close the outline segment.");
  });

  it("formats fallback board logical locations with stable coordinate text", () => {
    const payload = JSON.parse(
      formatSarif(
        sampleResult([
          createFinding({
            ruleId: "design.copper-balance",
            severity: "medium",
            message: "Copper balance is low near the board origin.",
            resource: { path: "board.kicad_pcb", kind: "pcb" },
            location: {
              boardCoordinates: {
                x: 14,
                y: -0,
                units: "in",
              },
            },
          }),
        ]),
      ),
    );

    expect(payload.runs[0].results[0].locations[0].logicalLocations).toEqual([
      {
        name: "board @ (14in, 0in)",
        kind: "member",
        fullyQualifiedName: "pcb:board:14in,0in",
      },
    ]);
  });

  it("keeps fallback SARIF regions valid when line or column are zero", () => {
    const payload = JSON.parse(
      formatSarif(
        sampleResult([
          createFinding({
            ruleId: "bom.missing-mpn",
            severity: "high",
            message: "R1 is missing an MPN.",
            resource: { path: "bom.csv", kind: "bom" },
            location: { line: 0, column: 0 },
          }),
        ]),
      ),
    );

    expect(payload.runs[0].results[0].locations[0].physicalLocation.region).toEqual({
      startLine: 1,
      startColumn: 1,
    });
  });

  it("renders PR Markdown for empty and populated finding sets without unresolved tokens", () => {
    const empty = formatMarkdown(sampleResult([]));
    expect(empty).toContain(stickyMarker);
    expect(empty).toContain("No findings.");
    expect(empty).not.toMatch(/{{|}}/);

    const populated = formatMarkdown(sampleResult(), [{ label: "SARIF", url: "https://example.test/sarif" }]);
    expect(populated).toContain("Top Findings");
    expect(populated).toContain("## Fix");
    expect(populated).toContain("Add manufacturer part numbers.");
    expect(populated).toContain("[SARIF](https://example.test/sarif)");
    expect(populated).not.toMatch(/{{|}}/);
  });

  it("renders pseudo-locale PR Markdown labels for hard-coded string smoke coverage", () => {
    const markdown = formatMarkdown(sampleResult([]), [], undefined, "__PSEUDO__");
    expect(markdown).toContain("# [[BoardReadyOps Report]]");
    expect(markdown).toContain("[[No findings.]]");
  });

  it("renders fabrication changes in PR Markdown", () => {
    const markdown = formatMarkdown(sampleResult(), [], {
      bom: {
        truncated: false,
        rows: [
          {
            reference: "C45",
            previous: "",
            current: "100nF 0402",
            status: "added",
          },
        ],
      },
      outputs: [
        { kind: "drill", status: "changed", changed: 1, added: 0, removed: 0 },
        { kind: "bom", status: "changed", changed: 0, added: 2, removed: 1 },
        { kind: "gerber", status: "unchanged", changed: 0, added: 0, removed: 0 },
      ],
      findings: {
        added: [sampleFinding()],
        removed: [],
        unchanged: [],
      },
    });

    expect(markdown).toContain("Fabrication Changes");
    expect(markdown).toContain("| C45 | - | 100nF 0402 | added |");
    expect(markdown).toContain("- drill: changed (1 changed)");
    expect(markdown).toContain("- bom: changed (2 added, 1 removed)");
    expect(markdown).toContain("- gerber: unchanged");
    expect(markdown).toContain("New Findings");
  });

  it("limits new finding rows in fabrication changes", () => {
    const added = Array.from({ length: 12 }, (_, index) =>
      createFinding({
        ruleId: "bom.missing-mpn",
        severity: "high",
        message: `Missing MPN ${index}.`,
        resource: { path: `bom-${index}.csv`, kind: "bom" },
      }),
    );

    const markdown = formatMarkdown(sampleResult(), [], {
      bom: { truncated: false, rows: [] },
      outputs: [],
      findings: {
        added,
        removed: [],
        unchanged: [],
      },
    });

    expect(markdown).toContain("Missing MPN 0.");
    expect(markdown).toContain("Missing MPN 9.");
    expect(markdown).not.toContain("Missing MPN 10.");
    expect(markdown).toContain("_...and 2 more new findings._");
  });

  it("renders fixes from findings outside the top finding summary", () => {
    const findings = Array.from({ length: 10 }, (_, index) =>
      createFinding({
        ruleId: "bom.missing-mpn",
        severity: "high",
        message: `Missing MPN ${index}.`,
        resource: { path: `bom-${index}.csv`, kind: "bom" },
      }),
    );
    findings.push(
      createFinding({
        ruleId: "bom.single-source",
        severity: "medium",
        message: "R1 has one source.",
        resource: { path: "late-bom.csv", kind: "bom" },
        fix: { description: "Add an alternate approved source." },
      }),
    );

    const markdown = formatMarkdown(sampleResult(findings));
    expect(markdown).toContain("## Fix");
    expect(markdown).toContain("Add an alternate approved source.");
  });

  it("carries stable finding identity across JSON SARIF Markdown and JUnit", () => {
    const result = sampleResult();
    const stableId = result.findings[0]?.fingerprint.slice(0, 12);
    const location = "bom.csv:2:1";

    expect(JSON.parse(formatJson(result)).findings[0]).toMatchObject({
      fingerprint: result.findings[0]?.fingerprint,
      location: { line: 2, column: 1 },
    });

    const sarif = JSON.parse(formatSarif(result));
    expect(sarif.runs[0].results[0].properties).toMatchObject({
      stableId,
      fingerprint: result.findings[0]?.fingerprint,
      reportLocation: location,
      help: "Add manufacturer part numbers.",
    });

    const markdown = formatMarkdown(result);
    expect(markdown).toContain(`in \`${location}\` (\``);
    expect(markdown).toContain(stableId);

    const junit = formatJunit(result);
    expect(junit).toContain(`id="${stableId}"`);
    expect(junit).toContain(`name="${location}"`);
    expect(junit).toContain("Add manufacturer part numbers.");
  });

  it("keeps fix metadata in JSON output", () => {
    const payload = JSON.parse(formatJson(sampleResult()));
    expect(payload.findings[0]).toMatchObject({
      project: "assembly/main.kicad_pro",
      fix: {
        description: "Add manufacturer part numbers.",
        steps: ["Populate the MPN column.", "Re-run the BOM check."],
      },
      confidence: "high",
    });
  });

  it("includes BOM risk summary section when bomRisk is present", () => {
    const base = sampleResult([]);
    const result: RunResult = {
      ...base,
      bomRisk: {
        totalComponents: 4,
        overallRiskScore: 45,
        overallRiskLevel: "high",
        criticalCount: 0,
        highCount: 2,
        mediumCount: 1,
        lowCount: 1,
        components: [
          {
            reference: "U2",
            mpn: undefined,
            manufacturer: undefined,
            riskScore: 60,
            riskLevel: "high",
            factors: {
              missingMpn: true,
              missingManufacturer: true,
              noSuppliers: true,
              singleSourceNoAlternates: false,
            },
          },
          {
            reference: "C1",
            mpn: "CAP-100N",
            manufacturer: "Murata",
            riskScore: 25,
            riskLevel: "medium",
            factors: {
              missingMpn: false,
              missingManufacturer: false,
              noSuppliers: false,
              singleSourceNoAlternates: true,
            },
          },
          {
            reference: "R1",
            mpn: "RES-0402",
            manufacturer: "Yageo",
            riskScore: 10,
            riskLevel: "low",
            // all factors false — exercises the "—" factorsSummary fallback
            factors: {
              missingMpn: false,
              missingManufacturer: false,
              noSuppliers: false,
              singleSourceNoAlternates: false,
            },
          },
          {
            reference: "Q1",
            mpn: "MOSFET-N",
            manufacturer: undefined,
            riskScore: 0,
            riskLevel: "none",
            factors: {
              missingMpn: false,
              missingManufacturer: false,
              noSuppliers: false,
              singleSourceNoAlternates: false,
            },
          },
        ],
      },
    };
    const markdown = formatMarkdown(result);
    expect(markdown).toContain("BOM Supply-Chain Risk");
    expect(markdown).toContain("U2");
    expect(markdown).toContain("no MPN");
    expect(markdown).toContain("no manufacturer");
  });
});

function sampleResult(findings = [sampleFinding()]): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.0.0" },
    summary: summarizeFindings(findings, "high"),
    projects: [],
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-05-18T00:00:00.000Z",
  };
}

function sampleFinding() {
  return createFinding({
    ruleId: "bom.missing-mpn",
    severity: "high",
    message: "R1 is missing an MPN.",
    project: "assembly/main.kicad_pro",
    resource: { path: "bom.csv", kind: "bom" },
    location: { line: 2, column: 1 },
    details: { reference: "R1" },
    references: ["https://github.com/oaslananka/boardreadyops/blob/main/docs/rules/bom.md"],
    fix: {
      description: "Add manufacturer part numbers.",
      steps: ["Populate the MPN column.", "Re-run the BOM check."],
      references: ["https://example.test/mpn"],
      automated: false,
    },
    confidence: "high",
  });
}

const sarifSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["version", "$schema", "runs"],
  properties: {
    version: { const: "2.1.0" },
    $schema: { type: "string" },
    runs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["tool", "results"],
        properties: {
          tool: {
            type: "object",
            required: ["driver"],
            properties: {
              driver: {
                type: "object",
                required: ["name", "version", "rules"],
                properties: {
                  name: { const: "BoardReadyOps" },
                  version: { type: "string" },
                  rules: { type: "array" },
                },
              },
            },
          },
          results: {
            type: "array",
            items: {
              type: "object",
              required: ["ruleId", "level", "message", "locations", "partialFingerprints"],
              properties: {
                ruleId: { type: "string" },
                level: { enum: ["error", "warning", "note", "none"] },
                message: { type: "object", required: ["text"] },
                locations: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    required: ["physicalLocation"],
                    properties: {
                      physicalLocation: {
                        type: "object",
                        required: ["artifactLocation", "region"],
                        properties: {
                          artifactLocation: {
                            type: "object",
                            required: ["uri"],
                            properties: {
                              uri: { type: "string" },
                            },
                          },
                          region: {
                            type: "object",
                            required: ["startLine"],
                            properties: {
                              startLine: { type: "integer", minimum: 1 },
                              endLine: { type: "integer", minimum: 1 },
                              startColumn: { type: "integer", minimum: 1 },
                              endColumn: { type: "integer", minimum: 1 },
                            },
                          },
                        },
                      },
                      logicalLocations: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["name", "fullyQualifiedName", "kind"],
                          properties: {
                            name: { type: "string" },
                            fullyQualifiedName: { type: "string" },
                            kind: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
                partialFingerprints: {
                  type: "object",
                  required: ["primaryLocationLineHash"],
                  properties: {
                    primaryLocationLineHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
