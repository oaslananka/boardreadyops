import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "../../../src/core/findings.js";
import {
  clearRulesForTests,
  type RuleEvidenceType,
  registerRule,
  summarizeFindingEvidence,
} from "../../../src/core/rule-registry.js";

/**
 * `summarizeFindingEvidence` answers a question a reviewer could not previously ask: of the
 * findings about to stop this release, how many are things we measured and how many are things we
 * inferred? `RuleEvidenceType` had been declared on every built-in rule and read by nothing but a
 * telemetry field, while `shouldFail` weighed severity alone. See #753.
 */

function fakeRule(id: string, evidenceType: RuleEvidenceType) {
  return {
    meta: {
      id,
      title: id,
      description: id,
      rationale: id,
      defaultSeverity: "medium" as const,
      appliesTo: [],
      configKeys: [],
      kicadVersions: ["10" as const],
      tags: [],
      category: "manufacturability" as const,
      evidenceType,
      fixability: "manual" as const,
      vendorDependence: "none" as const,
    },
    async run() {
      return [];
    },
  };
}

function finding(ruleId: string, severity: Finding["severity"], extra: Partial<Finding> = {}): Finding {
  return {
    ruleId,
    severity,
    message: `${ruleId} finding`,
    resource: { path: "board.kicad_pcb", kind: "pcb" },
    fingerprint: `${ruleId}-${severity}`,
    ...extra,
  };
}

describe("summarizeFindingEvidence", () => {
  beforeEach(() => {
    clearRulesForTests();
    registerRule(fakeRule("design.board-outline", "exact"));
    registerRule(fakeRule("bom.risk-score", "heuristic"));
    registerRule(fakeRule("mfg.fab-notes", "heuristic"));
  });

  afterEach(() => {
    clearRulesForTests();
  });

  it("counts findings by the evidence their rule rests on", () => {
    const summary = summarizeFindingEvidence(
      [
        finding("design.board-outline", "high"),
        finding("bom.risk-score", "medium"),
        finding("mfg.fab-notes", "low"),
        finding("plugin.unknown-rule", "high"),
      ],
      "high",
    );

    expect(summary.exact).toBe(1);
    expect(summary.heuristic).toBe(2);
    // A finding whose rule is not in the registry -- a stale fingerprint, or a since-removed
    // plugin rule -- is unclassified rather than silently counted as measured.
    expect(summary.unclassified).toBe(1);
  });

  it("names the rules that can fail the run without resting on a measurement", () => {
    const summary = summarizeFindingEvidence(
      [
        finding("design.board-outline", "critical"),
        finding("bom.risk-score", "high"),
        finding("mfg.fab-notes", "critical"),
      ],
      "high",
    );

    // The exact one is not the reviewer's problem here: it blocks, and it measured something.
    expect(summary.blockingOnInference).toEqual(["bom.risk-score", "mfg.fab-notes"]);
  });

  it("leaves out an inferred finding that is below the failure threshold", () => {
    const summary = summarizeFindingEvidence([finding("bom.risk-score", "medium")], "high");

    // It will not stop the release, so it is not part of the question being asked.
    expect(summary.blockingOnInference).toEqual([]);
    expect(summary.heuristic).toBe(1);
  });

  it("includes it once the threshold drops to meet it", () => {
    const summary = summarizeFindingEvidence([finding("bom.risk-score", "medium")], "medium");
    expect(summary.blockingOnInference).toEqual(["bom.risk-score"]);
  });

  it("ignores a waived finding, however it was derived", () => {
    const summary = summarizeFindingEvidence([finding("bom.risk-score", "critical", { suppressed: true })], "high");

    // A waiver already removed it from `shouldFail`, so listing it would send the reviewer after
    // something that cannot stop anything.
    expect(summary.blockingOnInference).toEqual([]);
    // It is still counted, because the question "how much of this rests on inference" includes it.
    expect(summary.heuristic).toBe(1);
  });

  it("ignores an informational finding", () => {
    const summary = summarizeFindingEvidence([finding("bom.risk-score", "info")], "low");
    expect(summary.blockingOnInference).toEqual([]);
  });

  it("finds nothing blocking when the run cannot fail", () => {
    const summary = summarizeFindingEvidence(
      [finding("bom.risk-score", "critical"), finding("mfg.fab-notes", "critical")],
      "never",
    );

    expect(summary.blockingOnInference).toEqual([]);
    expect(summary.heuristic).toBe(2);
  });

  it("reports each rule once however many findings it raised", () => {
    const summary = summarizeFindingEvidence(
      [
        finding("bom.risk-score", "high", { fingerprint: "a" }),
        finding("bom.risk-score", "high", { fingerprint: "b" }),
        finding("bom.risk-score", "critical", { fingerprint: "c" }),
      ],
      "high",
    );

    // The reviewer is deciding about a rule, not about each row it produced.
    expect(summary.blockingOnInference).toEqual(["bom.risk-score"]);
    expect(summary.heuristic).toBe(3);
  });

  it("returns zeroes for no findings at all", () => {
    expect(summarizeFindingEvidence([], "high")).toEqual({
      exact: 0,
      heuristic: 0,
      unclassified: 0,
      blockingOnInference: [],
    });
  });

  it("does not change what blocks", () => {
    // Worth pinning: this function is a reporting surface. If it ever starts deciding outcomes,
    // boards move from failing to passing, and nobody should learn that from a release that
    // shipped. `shouldFail` remains the only authority on the verdict.
    const findings = [finding("bom.risk-score", "critical")];
    const before = JSON.stringify(findings);
    summarizeFindingEvidence(findings, "high");
    expect(JSON.stringify(findings)).toBe(before);
  });
});
