import { describe, expect, it } from "vitest";
import {
  canonicalFingerprint,
  computeEvidenceDigest,
  computeFindingDiff,
  type InputFinding,
} from "../../../packages/cloud-core/src/review-diff.js";

describe("Review Diff & Finding Lifecycle Engine", () => {
  it("computes new, persistent, regressed, and resolved finding states accurately", () => {
    const baseFindings: InputFinding[] = [
      {
        fingerprint: "1".repeat(64),
        ruleId: "BR-CLEARANCE-001",
        severity: "medium",
        message: "Clearance violation 0.15mm < 0.2mm",
        path: "board.kicad_pcb",
      },
      {
        fingerprint: "2".repeat(64),
        ruleId: "BR-SILK-001",
        severity: "low",
        message: "Silkscreen clipped on edge",
        path: "board.kicad_pcb",
      },
      {
        fingerprint: "3".repeat(64),
        ruleId: "BR-POWER-001",
        severity: "low",
        message: "Decoupling cap distance",
        path: "board.kicad_sch",
        currentDisposition: "fixed",
      },
    ];

    const headFindings: InputFinding[] = [
      // Persistent unchanged
      {
        fingerprint: "1".repeat(64),
        ruleId: "BR-CLEARANCE-001",
        severity: "medium",
        message: "Clearance violation 0.15mm < 0.2mm",
        path: "board.kicad_pcb",
      },
      // Regressed (was fixed in base, re-appeared in head)
      {
        fingerprint: "3".repeat(64),
        ruleId: "BR-POWER-001",
        severity: "low",
        message: "Decoupling cap distance",
        path: "board.kicad_sch",
      },
      // New finding in head
      {
        fingerprint: "4".repeat(64),
        ruleId: "BR-DRILL-001",
        severity: "error",
        message: "Drill aspect ratio exceeded",
        path: "board.kicad_pcb",
      },
    ];

    const diff = computeFindingDiff(baseFindings, headFindings);

    expect(diff.counts.total).toBe(4);
    expect(diff.counts.new).toBe(1);
    expect(diff.counts.persistent).toBe(1);
    expect(diff.counts.regressed).toBe(1);
    expect(diff.counts.resolved).toBe(1);

    const newFinding = diff.items.find((i) => i.fingerprint === "4".repeat(64));
    expect(newFinding?.diffState).toBe("new");

    const persistentFinding = diff.items.find((i) => i.fingerprint === "1".repeat(64));
    expect(persistentFinding?.diffState).toBe("persistent");

    const regressedFinding = diff.items.find((i) => i.fingerprint === "3".repeat(64));
    expect(regressedFinding?.diffState).toBe("regressed");

    const resolvedFinding = diff.items.find((i) => i.fingerprint === "2".repeat(64));
    expect(resolvedFinding?.diffState).toBe("resolved");
    expect(resolvedFinding?.currentDisposition).toBe("fixed");

    expect(diff.hasBlockers).toBe(true); // ruleId BR-DRILL-001 is severity 'error'
  });

  it("marks severity escalation as regressed", () => {
    const base: InputFinding[] = [
      {
        fingerprint: "5".repeat(64),
        ruleId: "BR-THERMAL-001",
        severity: "low",
        message: "Thermal relief missing",
      },
    ];

    const head: InputFinding[] = [
      {
        fingerprint: "5".repeat(64),
        ruleId: "BR-THERMAL-001",
        severity: "high",
        message: "Thermal relief missing",
      },
    ];

    const diff = computeFindingDiff(base, head);
    expect(diff.counts.regressed).toBe(1);
    expect(diff.items[0]?.diffState).toBe("regressed");
  });

  it("generates deterministic fallback fingerprint when missing", () => {
    const findingA: InputFinding = {
      ruleId: "BR-PWR-01",
      severity: "high",
      message: "Floating power pin VDD",
      path: "schematics/power.kicad_sch",
    };
    const findingB: InputFinding = {
      ruleId: "BR-PWR-01",
      severity: "high",
      message: "Floating power pin VDD",
      path: "schematics/power.kicad_sch",
    };

    const fpA = canonicalFingerprint(findingA);
    const fpB = canonicalFingerprint(findingB);

    expect(fpA).toMatch(/^[0-9a-f]{64}$/);
    expect(fpA).toBe(fpB);
  });

  it("computes stable SHA-256 evidence digest across sorted findings and artifacts", () => {
    const digest1 = computeEvidenceDigest({
      toolVersion: "1.34.0",
      kicadVersion: "8.0.4",
      rulePackDigest: "a".repeat(64),
      configDigest: "b".repeat(64),
      headCommitSha: "1234567890abcdef1234567890abcdef12345678",
      findingFingerprints: ["2".repeat(64), "1".repeat(64)],
      artifactDigests: [
        { name: "gerbers.zip", sha256: "c".repeat(64) },
        { name: "bom.csv", sha256: "d".repeat(64) },
      ],
    });

    const digest2 = computeEvidenceDigest({
      toolVersion: "1.34.0",
      kicadVersion: "8.0.4",
      rulePackDigest: "a".repeat(64),
      configDigest: "b".repeat(64),
      headCommitSha: "1234567890abcdef1234567890abcdef12345678",
      findingFingerprints: ["1".repeat(64), "2".repeat(64)],
      artifactDigests: [
        { name: "bom.csv", sha256: "d".repeat(64) },
        { name: "gerbers.zip", sha256: "c".repeat(64) },
      ],
    });

    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
    expect(digest1).toBe(digest2);
  });
});
