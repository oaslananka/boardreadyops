import { describe, expect, it } from "vitest";
import { createFinding, type Finding } from "../../../src/core/findings.js";
import { computeReadiness } from "../../../src/core/readiness.js";

function finding(severity: Finding["severity"], suppressed = false): Finding {
  return createFinding({
    ruleId: `rule.${severity}`,
    severity,
    message: `${severity} finding`,
    resource: { path: "board.kicad_pcb", kind: "pcb" },
    ...(suppressed ? { suppressed: true } : {}),
  });
}

describe("readiness scoring", () => {
  it("is ready with full evidence and no findings", () => {
    const result = computeReadiness({
      profile: { id: "jlcpcb", name: "JLCPCB", service: "fabrication+assembly" },
      requiredOutputs: ["bom", "gerber"],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(["bom", "gerber", "pdf"]),
      findings: [],
      failOn: "high",
    });
    expect(result.status).toBe("ready");
    expect(result.score).toBe(100);
    expect(result.missingRequired).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("is blocked when a required output is missing", () => {
    const result = computeReadiness({
      requiredOutputs: ["bom", "gerber"],
      recommendedOutputs: [],
      presentOutputs: new Set(["bom"]),
      findings: [],
      failOn: "high",
    });
    expect(result.status).toBe("blocked");
    expect(result.missingRequired).toEqual(["gerber"]);
    expect(result.score).toBeLessThan(100);
    expect(result.warnings).toContain("Required output gerber is missing.");
  });

  it("separates blocking and non-blocking findings by the fail-on threshold", () => {
    const result = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: [],
      presentOutputs: new Set(),
      findings: [finding("critical"), finding("low"), finding("high", true), finding("info")],
      failOn: "high",
    });
    // critical >= high -> blocking; low -> non-blocking; suppressed high -> ignored; info -> ignored
    expect(result.blocking).toBe(1);
    expect(result.nonBlocking).toBe(1);
    expect(result.status).toBe("blocked");
  });

  it("treats every finding as non-blocking when fail-on is never", () => {
    const result = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: [],
      presentOutputs: new Set(),
      findings: [finding("critical")],
      failOn: "never",
    });
    expect(result.blocking).toBe(0);
    expect(result.nonBlocking).toBe(1);
    expect(result.status).toBe("at-risk");
  });

  it("is at-risk when only recommended evidence is missing", () => {
    const result = computeReadiness({
      requiredOutputs: ["gerber"],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(["gerber"]),
      findings: [],
      failOn: "high",
    });
    expect(result.status).toBe("at-risk");
    expect(result.missingRecommended).toEqual(["pdf"]);
  });
});

describe("release mode — prototype and pilot", () => {
  it("prototype: missing recommended outputs produce at-risk status (unchanged behavior)", () => {
    const result = computeReadiness({
      requiredOutputs: ["gerber"],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(["gerber"]),
      findings: [],
      failOn: "high",
      releaseMode: "prototype",
    });
    expect(result.status).toBe("at-risk");
    expect(result.missingRecommended).toEqual(["pdf"]);
    expect(result.warnings).toContain("Recommended output pdf is missing.");
  });

  it("prototype: expired waivers do not affect readiness status", () => {
    const result = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: [],
      presentOutputs: new Set(),
      findings: [],
      failOn: "high",
      releaseMode: "prototype",
      expiredWaivers: 3,
    });
    expect(result.status).toBe("ready");
    expect(result.warnings).toEqual([]);
  });

  it("pilot: missing recommended outputs produce at-risk status (same as prototype)", () => {
    const result = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(),
      findings: [],
      failOn: "high",
      releaseMode: "pilot",
    });
    expect(result.status).toBe("at-risk");
  });
});

describe("release mode — production", () => {
  it("production: missing recommended outputs produce blocked status", () => {
    const result = computeReadiness({
      requiredOutputs: ["gerber"],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(["gerber"]),
      findings: [],
      failOn: "high",
      releaseMode: "production",
    });
    expect(result.status).toBe("blocked");
    expect(result.missingRecommended).toEqual(["pdf"]);
    expect(result.warnings).toContain("Recommended output pdf is required in production mode.");
  });

  it("production: expired waivers produce blocked status", () => {
    const result = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: [],
      presentOutputs: new Set(),
      findings: [],
      failOn: "high",
      releaseMode: "production",
      expiredWaivers: 2,
    });
    expect(result.status).toBe("blocked");
    expect(result.warnings).toContain("2 expired waiver(s) must be renewed or removed before production release.");
  });

  it("production: is ready when all outputs present and no expired waivers", () => {
    const result = computeReadiness({
      requiredOutputs: ["gerber"],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(["gerber", "pdf"]),
      findings: [],
      failOn: "high",
      releaseMode: "production",
      expiredWaivers: 0,
    });
    expect(result.status).toBe("ready");
    expect(result.score).toBe(100);
  });

  it("production: score is penalized for expired waivers", () => {
    const noExpiredResult = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: [],
      presentOutputs: new Set(),
      findings: [],
      failOn: "high",
      releaseMode: "production",
      expiredWaivers: 0,
    });
    const expiredResult = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: [],
      presentOutputs: new Set(),
      findings: [],
      failOn: "high",
      releaseMode: "production",
      expiredWaivers: 1,
    });
    expect(expiredResult.score).toBeLessThan(noExpiredResult.score);
  });

  it("production: missing recommended and expired waivers both contribute to blocked status", () => {
    const result = computeReadiness({
      requiredOutputs: [],
      recommendedOutputs: ["pdf"],
      presentOutputs: new Set(),
      findings: [],
      failOn: "high",
      releaseMode: "production",
      expiredWaivers: 1,
    });
    expect(result.status).toBe("blocked");
    expect(result.warnings.length).toBe(2);
  });
});
