import { describe, expect, it } from "vitest";
import { createFinding } from "../../../src/core/findings.js";
import { buildReleaseTrends } from "../../../src/core/history.js";
import type { RunResult } from "../../../src/core/result.js";

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "0.0.0" },
    status: "passed",
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, failed: false },
    findings: [],
    fabrication: { bom: [], outputs: [] },
    projects: [],
    ...overrides,
  } as RunResult;
}

describe("buildReleaseTrends", () => {
  it("returns empty trend for empty input", () => {
    const trend = buildReleaseTrends([]);

    expect(trend.runCount).toBe(0);
    expect(trend.from).toBeNull();
    expect(trend.to).toBeNull();
    expect(trend.recurringFindings).toHaveLength(0);
    expect(trend.scoreTrend).toBe("insufficient-data");
  });

  it("captures readiness score data points", () => {
    const runs = [
      makeRun({
        generatedAt: "2026-01-01T00:00:00.000Z",
        readiness: {
          score: 60,
          status: "at-risk",
          blocking: 0,
          nonBlocking: 1,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
      makeRun({
        generatedAt: "2026-02-01T00:00:00.000Z",
        readiness: {
          score: 80,
          status: "ready",
          blocking: 0,
          nonBlocking: 0,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
    ];

    const trend = buildReleaseTrends(runs);

    expect(trend.runCount).toBe(2);
    expect(trend.readiness[0]).toMatchObject({ score: 60, status: "at-risk", passed: true });
    expect(trend.readiness[1]).toMatchObject({ score: 80, status: "ready", passed: true });
  });

  it("detects improving score trend", () => {
    const runs = [
      makeRun({
        generatedAt: "2026-01-01T00:00:00.000Z",
        readiness: {
          score: 50,
          status: "at-risk",
          blocking: 0,
          nonBlocking: 0,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
      makeRun({
        generatedAt: "2026-02-01T00:00:00.000Z",
        readiness: {
          score: 90,
          status: "ready",
          blocking: 0,
          nonBlocking: 0,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
    ];

    expect(buildReleaseTrends(runs).scoreTrend).toBe("improving");
  });

  it("detects degrading score trend", () => {
    const runs = [
      makeRun({
        generatedAt: "2026-01-01T00:00:00.000Z",
        readiness: {
          score: 90,
          status: "ready",
          blocking: 0,
          nonBlocking: 0,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
      makeRun({
        generatedAt: "2026-02-01T00:00:00.000Z",
        readiness: {
          score: 50,
          status: "blocked",
          blocking: 1,
          nonBlocking: 0,
          evidence: [],
          missingRequired: ["gerber"],
          missingRecommended: [],
          warnings: [],
        },
      }),
    ];

    expect(buildReleaseTrends(runs).scoreTrend).toBe("degrading");
  });

  it("returns flat for negligible delta", () => {
    const runs = [
      makeRun({
        generatedAt: "2026-01-01T00:00:00.000Z",
        readiness: {
          score: 80,
          status: "ready",
          blocking: 0,
          nonBlocking: 0,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
      makeRun({
        generatedAt: "2026-02-01T00:00:00.000Z",
        readiness: {
          score: 81,
          status: "ready",
          blocking: 0,
          nonBlocking: 0,
          evidence: [],
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
      }),
    ];

    expect(buildReleaseTrends(runs).scoreTrend).toBe("flat");
  });

  it("identifies recurring findings across multiple runs", () => {
    const recurringFinding = createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "R1 missing MPN",
      resource: { path: "bom.csv", kind: "bom" },
    });
    const oneTimeFinding = createFinding({
      ruleId: "design.board-outline",
      severity: "critical",
      message: "Edge.Cuts open",
      resource: { path: "board.kicad_pcb", kind: "pcb" },
    });

    const runs = [
      makeRun({ findings: [recurringFinding] }),
      makeRun({ findings: [recurringFinding] }),
      makeRun({ findings: [recurringFinding, oneTimeFinding] }),
    ];

    const trend = buildReleaseTrends(runs);

    expect(trend.recurringFindings[0]).toMatchObject({
      ruleId: "bom.missing-mpn",
      runCount: 3,
      maxSeverity: "high",
    });
    expect(trend.recurringFindings.some((finding) => finding.ruleId === "design.board-outline")).toBe(false);
  });

  it("records waiver data points for runs with waiver info", () => {
    const runs = [
      makeRun({
        generatedAt: "2026-01-01T00:00:00.000Z",
        waivers: {
          active: [
            { rule: "bom.missing-mpn", owner: "test", reason: "test", stale: false, expired: false, matched: 1 },
          ],
          expired: [],
        },
      }),
      makeRun({ generatedAt: "2026-02-01T00:00:00.000Z" }), // no waiver data
    ];

    const trend = buildReleaseTrends(runs);

    expect(trend.waivers).toHaveLength(1);
    expect(trend.waivers[0]).toMatchObject({ activeCount: 1, expiredCount: 0 });
  });

  it("tracks artifact kinds present in each run", () => {
    const runs = [
      makeRun({
        generatedAt: "2026-01-01T00:00:00.000Z",
        fabrication: {
          bom: [],
          outputs: [
            { kind: "gerber", files: [] },
            { kind: "drill", files: [] },
          ],
        },
      }),
      makeRun({
        generatedAt: "2026-02-01T00:00:00.000Z",
        fabrication: {
          bom: [],
          outputs: [{ kind: "gerber", files: [] }],
        },
      }),
    ];

    const trend = buildReleaseTrends(runs);

    expect(trend.artifactHealth[0]?.presentKinds).toEqual(["drill", "gerber"]);
    expect(trend.artifactHealth[1]?.presentKinds).toEqual(["gerber"]);
  });

  it("sets from and to timestamps", () => {
    const runs = [
      makeRun({ generatedAt: "2026-01-01T00:00:00.000Z" }),
      makeRun({ generatedAt: "2026-03-01T00:00:00.000Z" }),
    ];

    const trend = buildReleaseTrends(runs);

    expect(trend.from).toBe("2026-01-01T00:00:00.000Z");
    expect(trend.to).toBe("2026-03-01T00:00:00.000Z");
  });

  it("sorts recurring findings by runCount desc then ruleId asc when tied", () => {
    const run1 = makeRun({
      generatedAt: "2026-01-01T00:00:00.000Z",
      findings: [
        createFinding({
          ruleId: "rule.zzz",
          severity: "high",
          message: "z",
          resource: { path: "board.kicad_pcb", kind: "pcb" },
        }),
        createFinding({
          ruleId: "rule.aaa",
          severity: "medium",
          message: "a",
          resource: { path: "board.kicad_pcb", kind: "pcb" },
        }),
      ],
    });
    const run2 = makeRun({
      generatedAt: "2026-02-01T00:00:00.000Z",
      findings: [
        createFinding({
          ruleId: "rule.zzz",
          severity: "high",
          message: "z",
          resource: { path: "board.kicad_pcb", kind: "pcb" },
        }),
        createFinding({
          ruleId: "rule.aaa",
          severity: "medium",
          message: "a",
          resource: { path: "board.kicad_pcb", kind: "pcb" },
        }),
      ],
    });

    const trend = buildReleaseTrends([run1, run2]);

    expect(trend.recurringFindings).toHaveLength(2);
    // Both appear in 2 runs (tied) — secondary sort by ruleId ascending
    expect(trend.recurringFindings[0]?.ruleId).toBe("rule.aaa");
    expect(trend.recurringFindings[1]?.ruleId).toBe("rule.zzz");
  });

  it("excludes suppressed findings from recurring findings", () => {
    const suppressedFinding = {
      ...createFinding({
        ruleId: "rule.suppressed",
        severity: "high",
        message: "suppressed",
        resource: { path: "board.kicad_pcb", kind: "pcb" as const },
      }),
      suppressed: true,
    };
    const normalFinding = createFinding({
      ruleId: "rule.normal",
      severity: "medium",
      message: "normal",
      resource: { path: "board.kicad_pcb", kind: "pcb" as const },
    });
    const run1 = makeRun({ generatedAt: "2026-01-01T00:00:00.000Z", findings: [suppressedFinding, normalFinding] });
    const run2 = makeRun({ generatedAt: "2026-02-01T00:00:00.000Z", findings: [suppressedFinding, normalFinding] });

    const trend = buildReleaseTrends([run1, run2]);

    // Suppressed rule should not appear in recurring findings
    const ruleIds = trend.recurringFindings.map((r) => r.ruleId);
    expect(ruleIds).not.toContain("rule.suppressed");
    expect(ruleIds).toContain("rule.normal");
  });

  it("aggregates waiver counts from runs that have waivers", () => {
    const activeWaiver = {
      rule: "bom.missing-mpn",
      owner: "test",
      reason: "ok",
      stale: false,
      expired: false,
      matched: 1,
    };
    const expiredWaiver = {
      rule: "bom.missing-mpn",
      owner: "test",
      reason: "ok",
      stale: true,
      expired: true,
      matched: 0,
    };
    const run1 = makeRun({
      generatedAt: "2026-01-01T00:00:00.000Z",
      waivers: { active: [activeWaiver], expired: [] },
    });
    const run2 = makeRun({
      generatedAt: "2026-02-01T00:00:00.000Z",
      waivers: { active: [], expired: [expiredWaiver] },
    });
    const run3 = makeRun({ generatedAt: "2026-03-01T00:00:00.000Z" }); // no waivers

    const trend = buildReleaseTrends([run1, run2, run3]);

    expect(trend.waivers).toHaveLength(2); // run3 has no waivers, filtered out
    expect(trend.waivers[0]?.activeCount).toBe(1);
    expect(trend.waivers[0]?.expiredCount).toBe(0);
    expect(trend.waivers[1]?.activeCount).toBe(0);
    expect(trend.waivers[1]?.expiredCount).toBe(1);
  });
});
