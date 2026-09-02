import { describe, expect, it } from "vitest";
import {
  findingsToCheckRunAnnotations,
  findingToCheckRunAnnotation,
  mapFindingsForCloud,
} from "../../../src/core/cloud-findings.js";
import { createFinding } from "../../../src/core/findings.js";

describe("mapFindingsForCloud", () => {
  it("maps critical severity to error for the cloud wire contract", () => {
    const finding = createFinding({
      ruleId: "rules.example",
      severity: "critical",
      message: "Critical issue",
      project: "board.kicad_pro",
      resource: { path: "board.kicad_pcb", kind: "project" },
    });

    expect(mapFindingsForCloud([finding])).toEqual([
      expect.objectContaining({
        ruleId: "rules.example",
        severity: "error",
        message: "Critical issue",
        path: "board.kicad_pcb",
        project: "board.kicad_pro",
        fingerprint: finding.fingerprint,
      }),
    ]);
  });

  it("passes non-critical severities through unchanged", () => {
    const finding = createFinding({
      ruleId: "rules.example",
      severity: "medium",
      message: "Medium issue",
      resource: { path: "board.kicad_pcb", kind: "project" },
    });

    expect(mapFindingsForCloud([finding])).toEqual([expect.objectContaining({ severity: "medium" })]);
  });

  it("maps an empty findings array to an empty result", () => {
    expect(mapFindingsForCloud([])).toEqual([]);
  });
});

describe("findingToCheckRunAnnotation", () => {
  it("returns undefined for a finding with no location, since GitHub annotations require a line range", () => {
    const finding = createFinding({
      ruleId: "rules.example",
      severity: "high",
      message: "No location available",
      resource: { path: "board.kicad_pcb", kind: "project" },
    });

    expect(findingToCheckRunAnnotation(finding)).toBeUndefined();
  });

  it("builds an annotation from a simple line location", () => {
    const finding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "R1 is missing an MPN.",
      resource: { path: "hardware/bom.csv", kind: "bom" },
      location: { line: 12 },
    });

    expect(findingToCheckRunAnnotation(finding)).toEqual({
      path: "hardware/bom.csv",
      startLine: 12,
      endLine: 12,
      annotationLevel: "failure",
      message: "R1 is missing an MPN.",
      title: "bom.missing-mpn",
    });
  });

  it("prefers a region over a bare line, and carries columns through when present", () => {
    const finding = createFinding({
      ruleId: "design.silkscreen-overlap",
      severity: "medium",
      message: "Silkscreen overlaps courtyard.",
      resource: { path: "hardware/board.kicad_pcb", kind: "pcb" },
      location: { line: 1, region: { startLine: 4, endLine: 6, startColumn: 2, endColumn: 9 } },
    });

    expect(findingToCheckRunAnnotation(finding)).toEqual({
      path: "hardware/board.kicad_pcb",
      startLine: 4,
      endLine: 6,
      startColumn: 2,
      endColumn: 9,
      annotationLevel: "warning",
      message: "Silkscreen overlaps courtyard.",
      title: "design.silkscreen-overlap",
    });
  });

  it.each([
    ["critical", "failure"],
    ["high", "failure"],
    ["medium", "warning"],
    ["low", "notice"],
    ["info", "notice"],
  ] as const)("maps %s severity to annotation level %s", (severity, expectedLevel) => {
    const finding = createFinding({
      ruleId: "rules.example",
      severity,
      message: "message",
      resource: { path: "a.kicad_pcb", kind: "project" },
      location: { line: 1 },
    });

    expect(findingToCheckRunAnnotation(finding)?.annotationLevel).toBe(expectedLevel);
  });
});

describe("findingsToCheckRunAnnotations", () => {
  it("silently drops findings with no location instead of producing an invalid annotation", () => {
    const withLocation = createFinding({
      ruleId: "a",
      severity: "high",
      message: "has location",
      resource: { path: "a.kicad_pcb", kind: "project" },
      location: { line: 1 },
    });
    const withoutLocation = createFinding({
      ruleId: "b",
      severity: "high",
      message: "no location",
      resource: { path: "b.kicad_pcb", kind: "project" },
    });

    const annotations = findingsToCheckRunAnnotations([withLocation, withoutLocation]);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.message).toBe("has location");
  });

  it("maps an empty findings array to an empty result", () => {
    expect(findingsToCheckRunAnnotations([])).toEqual([]);
  });
});
