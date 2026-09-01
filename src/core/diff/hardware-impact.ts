import type { RunResult } from "../result.js";
import type { HardwareImpactBaselineReason, HardwareImpactV1 } from "./hardware-impact.types.js";
import { diffRuns, type RunDiff } from "./run.js";

export type { HardwareImpactBaselineReason, HardwareImpactV1 } from "./hardware-impact.types.js";

type HardwareImpactDomain = HardwareImpactV1["assessment"]["affectedDomains"][number];
type HardwareImpactRiskDirection = HardwareImpactV1["assessment"]["riskDirection"];
type HardwareImpactEvidenceRef = HardwareImpactV1["evidence"][number];
type HardwareImpactFacts = HardwareImpactV1["facts"];
type HardwareImpactAssessment = HardwareImpactV1["assessment"];

type BuildHardwareImpactInput =
  | {
      baseline: { status: "available"; sha: string; result: RunResult };
      candidate: { sha: string; result: RunResult };
    }
  | {
      baseline: { status: "unavailable"; sha: string; reason: HardwareImpactBaselineReason };
      candidate: { sha: string; result: RunResult };
    };

const DOMAIN_ORDER: HardwareImpactDomain[] = ["readiness", "findings", "bom", "manufacturing"];
const DOMAIN_RANK = new Map(DOMAIN_ORDER.map((domain, index) => [domain, index]));
const KIND_RANK = new Map<HardwareImpactEvidenceRef["kind"], number>([
  ["readiness", 0],
  ["finding", 1],
  ["bom-row", 2],
  ["output", 3],
]);
const MAX_EVIDENCE = 12;
const MAX_EVIDENCE_TEXT = 256;
const STATUS_RANK = { ready: 0, "at-risk": 1, blocked: 2 } as const;

export function buildHardwareImpact(input: BuildHardwareImpactInput): HardwareImpactV1 {
  if (input.baseline.status === "unavailable") {
    return unavailableImpact(input.baseline, input.candidate);
  }

  const diff = diffRuns(input.baseline.result, input.candidate.result);
  const facts = factsFromDiff(diff);
  return {
    version: 1,
    baseline: { status: "available", sha: input.baseline.sha },
    candidate: { sha: input.candidate.sha },
    facts,
    assessment: assessmentFromFacts(facts, input.baseline.result, input.candidate.result),
    evidence: evidenceFromDiff(diff),
  };
}

function unavailableImpact(
  baseline: { status: "unavailable"; sha: string; reason: HardwareImpactBaselineReason },
  candidate: { sha: string; result: RunResult },
): HardwareImpactV1 {
  const currentReadiness = candidate.result.readiness;
  return {
    version: 1,
    baseline: { status: "unavailable", sha: baseline.sha, reason: baseline.reason },
    candidate: { sha: candidate.sha },
    facts: {
      readiness: {
        previousScore: null,
        currentScore: currentReadiness?.score ?? null,
        scoreDelta: null,
        previousStatus: null,
        currentStatus: currentReadiness?.status ?? null,
        statusChanged: false,
      },
      findings: { added: 0, resolved: 0, addedBlocking: 0, resolvedBlocking: 0 },
      bom: { added: 0, removed: 0, changed: 0, truncated: false },
      manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 0 },
    },
    assessment: { materialChange: false, riskDirection: "unknown", affectedDomains: [] },
    evidence: [],
  };
}

function factsFromDiff(diff: RunDiff): HardwareImpactFacts {
  return {
    readiness: {
      previousScore: diff.readiness.previousScore,
      currentScore: diff.readiness.currentScore,
      scoreDelta: diff.readiness.scoreDelta,
      previousStatus: diff.readiness.previousStatus,
      currentStatus: diff.readiness.currentStatus,
      statusChanged: diff.readiness.previousStatus !== diff.readiness.currentStatus,
    },
    findings: {
      added: diff.findings.added.length,
      resolved: diff.findings.resolved.length,
      addedBlocking: diff.findings.added.filter((finding) => blockingSeverity(finding.severity)).length,
      resolvedBlocking: diff.findings.resolved.filter((finding) => blockingSeverity(finding.severity)).length,
    },
    bom: {
      // diff.fabrication.bom.rows is capped for display (see FabricationDiffOptions.maxBomRows), so
      // counting from it would silently undercount past the cap. addedCount/removedCount/changedCount
      // are computed before that cap and are the accurate source.
      added: diff.fabrication.bom.addedCount,
      removed: diff.fabrication.bom.removedCount,
      changed: diff.fabrication.bom.changedCount,
      truncated: diff.fabrication.bom.truncated,
    },
    manufacturing: {
      outputsAdded: countByStatus(diff.fabrication.outputs, "added"),
      outputsRemoved: countByStatus(diff.fabrication.outputs, "removed"),
      outputsChanged: countByStatus(diff.fabrication.outputs, "changed"),
    },
  };
}

function assessmentFromFacts(
  facts: HardwareImpactFacts,
  previous: RunResult,
  current: RunResult,
): HardwareImpactAssessment {
  const affectedDomains = DOMAIN_ORDER.filter((domain) => domainChanged(domain, facts));
  const materialChange = affectedDomains.length > 0;
  const readinessWorsened = statusMoved(facts.readiness.previousStatus, facts.readiness.currentStatus, "worse");
  const readinessImproved = statusMoved(facts.readiness.previousStatus, facts.readiness.currentStatus, "better");
  const conclusionWorsened = previous.status === "passed" && current.status === "failed";
  const conclusionImproved = previous.status === "failed" && current.status === "passed";
  const increased =
    readinessWorsened ||
    (facts.readiness.scoreDelta !== null && facts.readiness.scoreDelta < 0) ||
    facts.findings.addedBlocking > 0 ||
    conclusionWorsened;
  const decreased =
    readinessImproved ||
    (facts.readiness.scoreDelta !== null && facts.readiness.scoreDelta > 0) ||
    facts.findings.resolvedBlocking > 0 ||
    conclusionImproved;

  let riskDirection: HardwareImpactRiskDirection;
  if (increased) {
    riskDirection = "increased";
  } else if (decreased) {
    riskDirection = "decreased";
  } else if (materialChange) {
    riskDirection = "unknown";
  } else {
    riskDirection = "unchanged";
  }

  return { materialChange, riskDirection, affectedDomains };
}

function domainChanged(domain: HardwareImpactDomain, facts: HardwareImpactFacts): boolean {
  switch (domain) {
    case "readiness":
      return facts.readiness.scoreDelta !== null
        ? facts.readiness.scoreDelta !== 0 || facts.readiness.statusChanged
        : facts.readiness.statusChanged;
    case "findings":
      return facts.findings.added > 0 || facts.findings.resolved > 0;
    case "bom":
      return facts.bom.added > 0 || facts.bom.removed > 0 || facts.bom.changed > 0;
    case "manufacturing":
      return (
        facts.manufacturing.outputsAdded > 0 ||
        facts.manufacturing.outputsRemoved > 0 ||
        facts.manufacturing.outputsChanged > 0
      );
  }
}

function statusMoved(
  previous: HardwareImpactFacts["readiness"]["previousStatus"],
  current: HardwareImpactFacts["readiness"]["currentStatus"],
  direction: "better" | "worse",
): boolean {
  if (previous === null || current === null) return false;
  const delta = STATUS_RANK[current] - STATUS_RANK[previous];
  return direction === "worse" ? delta > 0 : delta < 0;
}

function blockingSeverity(severity: string): boolean {
  return severity === "critical" || severity === "high";
}

function countByStatus<T extends { status: string }>(entries: readonly T[], status: string): number {
  return entries.filter((entry) => entry.status === status).length;
}

function evidenceFromDiff(diff: RunDiff): HardwareImpactEvidenceRef[] {
  const evidence: HardwareImpactEvidenceRef[] = [];
  if (diff.readiness.scoreDelta !== 0 || diff.readiness.previousStatus !== diff.readiness.currentStatus) {
    evidence.push({
      domain: "readiness",
      kind: "readiness",
      label: bounded(
        `Readiness ${formatScore(diff.readiness.previousScore)} → ${formatScore(diff.readiness.currentScore)}; ${formatStatus(diff.readiness.previousStatus)} → ${formatStatus(diff.readiness.currentStatus)}`,
      ),
    });
  }
  for (const finding of diff.findings.added) {
    evidence.push(findingEvidence("Added finding", finding));
  }
  for (const finding of diff.findings.resolved) {
    evidence.push(findingEvidence("Resolved finding", finding));
  }
  for (const row of diff.fabrication.bom.rows.filter((entry) => entry.status !== "unchanged")) {
    evidence.push({
      domain: "bom",
      kind: "bom-row",
      label: bounded(`${capitalize(row.status)} BOM row ${row.reference}`),
    });
  }
  for (const output of diff.fabrication.outputs.filter((entry) => entry.status !== "unchanged")) {
    evidence.push({
      domain: "manufacturing",
      kind: "output",
      label: bounded(
        `${capitalize(output.status)} output ${output.kind} (changed ${output.changed}, added ${output.added}, removed ${output.removed})`,
      ),
    });
  }
  evidence.sort(compareEvidence);
  return evidence.slice(0, MAX_EVIDENCE);
}

function findingEvidence(prefix: string, finding: RunDiff["findings"]["added"][number]): HardwareImpactEvidenceRef {
  return {
    domain: "findings",
    kind: "finding",
    label: bounded(`${prefix}: ${finding.ruleId} — ${finding.message}`),
    path: bounded(finding.resourcePath),
    ruleId: bounded(finding.ruleId),
    severity: finding.severity,
    fingerprint: finding.fingerprint,
  };
}

function compareEvidence(left: HardwareImpactEvidenceRef, right: HardwareImpactEvidenceRef): number {
  return (
    (DOMAIN_RANK.get(left.domain) ?? 99) - (DOMAIN_RANK.get(right.domain) ?? 99) ||
    (KIND_RANK.get(left.kind) ?? 99) - (KIND_RANK.get(right.kind) ?? 99) ||
    compareText(left.label, right.label) ||
    compareText(left.path ?? "", right.path ?? "") ||
    compareText(left.ruleId ?? "", right.ruleId ?? "") ||
    compareText(left.severity ?? "", right.severity ?? "")
  );
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function bounded(value: string): string {
  return value.slice(0, MAX_EVIDENCE_TEXT);
}

function formatScore(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function formatStatus(value: HardwareImpactFacts["readiness"]["previousStatus"]): string {
  return value ?? "n/a";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
