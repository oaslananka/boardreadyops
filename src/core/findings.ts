import crypto from "node:crypto";
import { compareCodePoints, stableStringify } from "../util/strings.js";
import { listRules } from "./rule-registry.js";

const severityNames = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof severityNames)[number];
export type FailOn = Exclude<Severity, "info"> | "never";
export type ConfidenceLevel = "definite" | "high" | "medium" | "low";

export interface FixSuggestion {
  description: string;
  steps?: string[] | undefined;
  references?: string[] | undefined;
  automated?: boolean | undefined;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  project?: string | undefined;
  resource: {
    path: string;
    kind: "project" | "schematic" | "pcb" | "bom" | "pinmap" | "firmware" | "manifest";
  };
  location?: {
    line?: number | undefined;
    column?: number | undefined;
    region?: {
      startLine: number;
      endLine: number;
      startColumn?: number | undefined;
      endColumn?: number | undefined;
    };
    boardCoordinates?: {
      x: number;
      y: number;
      layer?: string | undefined;
      units: "mm" | "in";
    };
  };
  details?: Record<string, unknown> | undefined;
  references?: string[] | undefined;
  fix?: FixSuggestion | undefined;
  confidence?: ConfidenceLevel | undefined;
  fingerprint: string;
  suppressed?: boolean | undefined;
}

export interface FindingInput extends Omit<Finding, "fingerprint"> {
  fingerprint?: string;
}

export interface FindingSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  maxSeverity: Severity | "none";
  failed: boolean;
}

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && severityNames.includes(value as Severity);
}

export function severityRankValue(severity: Severity): number {
  return severityRank[severity];
}

function compareSeverity(a: Severity, b: Severity): number {
  return severityRankValue(b) - severityRankValue(a);
}

export function createFinding(input: FindingInput): Finding {
  return {
    ...input,
    fingerprint: input.fingerprint ?? fingerprintFor(input),
  };
}

export function fingerprintFor(input: Omit<Finding, "fingerprint">): string {
  const stable = stableStringify({
    ruleId: input.ruleId,
    ...(input.project === undefined ? {} : { project: input.project }),
    path: input.resource.path,
    kind: input.resource.kind,
    message: input.message,
    location: input.location,
    details: input.details,
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

export function summarizeFindings(
  findings: Finding[],
  failOn: FailOn,
  options?: { allowHeuristicBlock?: boolean },
): FindingSummary {
  const summary: FindingSummary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    maxSeverity: "none",
    failed: false,
  };
  for (const finding of findings) {
    summary[finding.severity] += 1;
    if (summary.maxSeverity === "none" || severityRank[finding.severity] > severityRank[summary.maxSeverity]) {
      summary.maxSeverity = finding.severity;
    }
  }
  summary.failed = shouldFail(findings, failOn, options);
  return summary;
}

export function shouldFail(findings: Finding[], failOn: FailOn, options?: { allowHeuristicBlock?: boolean }): boolean {
  if (failOn === "never") {
    return false;
  }
  const threshold = severityRank[failOn];
  const allowHeuristicBlock = options?.allowHeuristicBlock ?? false;
  const metaById = new Map(listRules().map((rule) => [rule.meta.id, rule.meta]));

  return findings.some((finding) => {
    if (finding.suppressed || finding.severity === "info") return false;
    if (severityRank[finding.severity] < threshold) return false;

    const evidenceType = metaById.get(finding.ruleId)?.evidenceType ?? "exact";
    if (evidenceType === "heuristic" && !allowHeuristicBlock) {
      return false;
    }
    return true;
  });
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compareSeverity(a.severity, b.severity) ||
      compareCodePoints(a.ruleId, b.ruleId) ||
      compareCodePoints(a.project ?? "", b.project ?? "") ||
      compareCodePoints(a.resource.path, b.resource.path) ||
      compareCodePoints(a.message, b.message),
  );
}
