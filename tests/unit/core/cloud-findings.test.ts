import { describe, expect, it } from "vitest";
import { mapFindingsForCloud } from "../../../src/core/cloud-findings.js";
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
