import { describe, expect, it } from "vitest";
import { createFinding, type FindingInput } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";

describe("Schema Compatibility & Legacy Fixtures", () => {
  it("normalizes a minimal legacy Finding without modern optional fields", () => {
    const legacyFindingInput: FindingInput = {
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "Component R1 is missing manufacturer part number",
      resource: {
        path: "hardware/board.kicad_sch",
        kind: "schematic",
      },
    };

    const finding = createFinding(legacyFindingInput);

    expect(finding.ruleId).toBe("bom.missing-mpn");
    expect(finding.severity).toBe("high");
    expect(finding.resource.path).toBe("hardware/board.kicad_sch");
    expect(finding.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(finding.suppressed).toBeUndefined();
  });

  it("preserves pre-computed fingerprints when normalizing existing findings", () => {
    const existingFingerprint = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const rawFinding: FindingInput = {
      ruleId: "design.clearance",
      severity: "medium",
      message: "Clearance violation",
      resource: {
        path: "board.kicad_pcb",
        kind: "pcb",
      },
      fingerprint: existingFingerprint,
    };

    const normalized = createFinding(rawFinding);
    expect(normalized.fingerprint).toBe(existingFingerprint);
  });

  it("safely processes legacy RunResult payloads missing recent fields", () => {
    const legacyRunResult: RunResult = {
      schemaVersion: 1,
      tool: {
        name: "boardreadyops",
        version: "1.0.0",
      },
      status: "passed",
      generatedAt: "2025-01-01T00:00:00.000Z",
      summary: {
        total: 0,
        bySeverity: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        failed: false,
      },
      findings: [],
      fabrication: {
        bom: [],
        outputs: [],
      },
      projects: [
        {
          projectFile: "test.kicad_pro",
          status: "passed",
          findingCount: 0,
        },
      ],
    };

    expect(legacyRunResult.schemaVersion).toBe(1);
    expect(legacyRunResult.status).toBe("passed");
    expect(legacyRunResult.findings).toHaveLength(0);
    expect(legacyRunResult.readiness).toBeUndefined();
    expect(legacyRunResult.policy).toBeUndefined();
    expect(legacyRunResult.waivers).toBeUndefined();
  });
});
