import type { PolicyConfig, PolicyRuleConfig } from "./config.js";
import { type FindingSummary, type Severity, severityRankValue } from "./findings.js";
import type { ReadinessScore } from "./readiness.js";

/** User-facing provenance classification; cryptographic elevation is performed at the CLI boundary. */
export interface SourceBoundPolicyEvidence {
  status: "source-bound-verified" | "byte-consistent-only" | "unverified";
  reason: string;
  sourceSha?: string | undefined;
  runInvocationURI?: string | undefined;
  subjects?: number | undefined;
}

interface PolicyRuleResult {
  id: string;
  type: PolicyRuleConfig["type"];
  status: "pass" | "fail";
  message: string;
}

export interface PolicyEvaluation {
  status: "pass" | "fail";
  enforced: boolean;
  rules: PolicyRuleResult[];
  sourceBound?: SourceBoundPolicyEvidence | undefined;
}

export interface PolicyInput {
  summary: FindingSummary;
  ruleIds: string[];
  readiness?: ReadinessScore | undefined;
  expiredWaivers?: number | undefined;
  staleWaivers?: number | undefined;
  sourceBound?: SourceBoundPolicyEvidence | undefined;
}

export function evaluatePolicy(policy: PolicyConfig, input: PolicyInput): PolicyEvaluation {
  const rules = (policy.rules ?? []).map((rule) => evaluateRule(rule, input));
  return {
    status: rules.some((rule) => rule.status === "fail") ? "fail" : "pass",
    enforced: policy.enforce ?? false,
    rules,
    ...(input.sourceBound ? { sourceBound: input.sourceBound } : {}),
  };
}

function evaluateRule(rule: PolicyRuleConfig, input: PolicyInput): PolicyRuleResult {
  const verdict = checkRule(rule, input);
  return { id: rule.id, type: rule.type, status: verdict.ok ? "pass" : "fail", message: verdict.message };
}

function checkRule(rule: PolicyRuleConfig, input: PolicyInput): { ok: boolean; message: string } {
  switch (rule.type) {
    case "max-severity":
      return checkMaxSeverity(rule.severity ?? "high", input.summary);
    case "max-findings":
      return checkMaxFindings(rule.max ?? 0, input.summary);
    case "min-readiness-score":
      return checkMinReadinessScore(rule.score ?? 0, input.readiness);
    case "require-readiness-status":
      return checkReadinessStatus(rule.status ?? ["ready"], input.readiness);
    case "require-required-outputs":
      return checkRequiredOutputs(input.readiness);
    case "require-source-bound-export":
      return checkSourceBoundExport(input.sourceBound);
    case "forbid-rules":
      return checkForbidRules(rule.rules ?? [], input.ruleIds);
    case "forbid-expired-waivers":
      return checkExpiredWaivers(input.expiredWaivers ?? 0);
    case "forbid-stale-waivers":
      return checkStaleWaivers(input.staleWaivers ?? 0);
  }
}

function checkSourceBoundExport(evidence: SourceBoundPolicyEvidence | undefined): { ok: boolean; message: string } {
  if (
    evidence?.status === "source-bound-verified" &&
    evidence.sourceSha &&
    evidence.runInvocationURI &&
    Number.isSafeInteger(evidence.subjects) &&
    (evidence.subjects ?? 0) > 0
  ) {
    return {
      ok: true,
      message: `Source-bound verified: ${evidence.subjects} signed subject(s), reviewed SHA ${evidence.sourceSha}, ${evidence.runInvocationURI}.`,
    };
  }
  return {
    ok: false,
    message:
      evidence?.status === "byte-consistent-only"
        ? "Byte-consistent only; an independently verified signed source-to-export proof is required."
        : "Source-bound proof is unverified or unavailable; strict policy fails closed.",
  };
}

function checkExpiredWaivers(expired: number): { ok: boolean; message: string } {
  return {
    ok: expired === 0,
    message: expired === 0 ? "No expired waivers." : `${expired} expired waiver(s) require renewal or removal.`,
  };
}

function checkStaleWaivers(stale: number): { ok: boolean; message: string } {
  return {
    ok: stale === 0,
    message: stale === 0 ? "No stale waivers." : `${stale} stale waiver(s) no longer match any finding.`,
  };
}

function checkMaxSeverity(severity: Severity, summary: FindingSummary): { ok: boolean; message: string } {
  const threshold = severityRankValue(severity);
  const offending = (["critical", "high", "medium", "low", "info"] as const)
    .filter((level) => severityRankValue(level) >= threshold)
    .reduce((total, level) => total + summary[level], 0);
  return {
    ok: offending === 0,
    message:
      offending === 0 ? `No findings at or above ${severity}.` : `${offending} finding(s) at or above ${severity}.`,
  };
}

function checkMaxFindings(max: number, summary: FindingSummary): { ok: boolean; message: string } {
  return {
    ok: summary.total <= max,
    message:
      summary.total <= max
        ? `${summary.total} finding(s) within the limit of ${max}.`
        : `${summary.total} finding(s) exceed the limit of ${max}.`,
  };
}

function checkMinReadinessScore(
  score: number,
  readiness: ReadinessScore | undefined,
): { ok: boolean; message: string } {
  const actual = readiness?.score ?? 0;
  return {
    ok: actual >= score,
    message:
      actual >= score
        ? `Readiness score ${actual} meets the minimum of ${score}.`
        : `Readiness score ${actual} is below the minimum of ${score}.`,
  };
}

function checkReadinessStatus(
  allowed: Array<"ready" | "at-risk" | "blocked">,
  readiness: ReadinessScore | undefined,
): { ok: boolean; message: string } {
  const status = readiness?.status;
  if (!status) {
    return { ok: false, message: "No readiness status is available." };
  }
  return {
    ok: allowed.includes(status),
    message: allowed.includes(status)
      ? `Readiness status ${status} is allowed.`
      : `Readiness status ${status} is not in [${allowed.join(", ")}].`,
  };
}

function checkRequiredOutputs(readiness: ReadinessScore | undefined): { ok: boolean; message: string } {
  const missing = readiness?.missingRequired ?? [];
  return {
    ok: missing.length === 0,
    message:
      missing.length === 0 ? "All required outputs are present." : `Missing required outputs: ${missing.join(", ")}.`,
  };
}

function checkForbidRules(forbidden: string[], ruleIds: string[]): { ok: boolean; message: string } {
  const present = forbidden.filter((id) => ruleIds.includes(id));
  return {
    ok: present.length === 0,
    message:
      present.length === 0
        ? "No forbidden rules produced findings."
        : `Forbidden rules present: ${present.join(", ")}.`,
  };
}

export function formatPolicyText(evaluation: PolicyEvaluation): string {
  const lines: string[] = [];
  lines.push(`Policy: ${evaluation.status.toUpperCase()}${evaluation.enforced ? " (enforced)" : " (advisory)"}`);
  if (evaluation.sourceBound) {
    const label = {
      "source-bound-verified": "SOURCE-BOUND VERIFIED",
      "byte-consistent-only": "BYTE-CONSISTENT ONLY",
      unverified: "UNVERIFIED",
    }[evaluation.sourceBound.status];
    lines.push(`Source export trust: ${label} (GA and release authorization remain separate)`);
  }
  for (const rule of evaluation.rules) {
    lines.push(`  ${rule.status === "pass" ? "PASS" : "FAIL"} ${rule.id}: ${rule.message}`);
  }
  return `${lines.join("\n")}\n`;
}
