import type { ReleaseMode } from "./config.types.js";
import { type FailOn, type Finding, severityRankValue } from "./findings.js";

interface ReadinessEvidence {
  output: string;
  importance: "required" | "recommended";
  present: boolean;
}

export interface ReadinessScore {
  profile?: { id: string; name: string; service: string } | undefined;
  score: number;
  status: "ready" | "at-risk" | "blocked";
  blocking: number;
  nonBlocking: number;
  evidence: ReadinessEvidence[];
  missingRequired: string[];
  missingRecommended: string[];
  warnings: string[];
}

export interface ReadinessInput {
  profile?: { id: string; name: string; service: string } | undefined;
  requiredOutputs: string[];
  recommendedOutputs: string[];
  presentOutputs: Set<string>;
  findings: Finding[];
  failOn: FailOn;
  releaseMode?: ReleaseMode | undefined;
  /** Number of expired waivers; in production mode these block the release. */
  expiredWaivers?: number | undefined;
}

const REQUIRED_PENALTY = 25;
const RECOMMENDED_PENALTY = 8;
const BLOCKING_PENALTY = 15;
const NON_BLOCKING_PENALTY = 3;

function isBlocking(finding: Finding, failOn: FailOn): boolean {
  if (failOn === "never" || finding.suppressed || finding.severity === "info") {
    return false;
  }
  return severityRankValue(finding.severity) >= severityRankValue(failOn);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizedOutputs(input: ReadinessInput): { required: string[]; recommended: string[] } {
  const required = [...new Set(input.requiredOutputs)].sort((a, b) => a.localeCompare(b));
  const recommended = [...new Set(input.recommendedOutputs)]
    .filter((output) => !required.includes(output))
    .sort((a, b) => a.localeCompare(b));
  return { required, recommended };
}

function countFindings(findings: Finding[], failOn: FailOn): { blocking: number; nonBlocking: number } {
  let blocking = 0;
  let nonBlocking = 0;
  for (const finding of findings) {
    if (finding.suppressed || finding.severity === "info") continue;
    if (isBlocking(finding, failOn)) blocking += 1;
    else nonBlocking += 1;
  }
  return { blocking, nonBlocking };
}

function readinessWarnings(
  missingRequired: string[],
  missingRecommended: string[],
  blocking: number,
  isProduction: boolean,
  expiredWaivers: number,
): string[] {
  const warnings = missingRequired.map((output) => `Required output ${output} is missing.`);
  warnings.push(
    ...missingRecommended.map((output) =>
      isProduction
        ? `Recommended output ${output} is required in production mode.`
        : `Recommended output ${output} is missing.`,
    ),
  );
  if (blocking > 0) warnings.push(`${blocking} blocking finding(s) must be resolved before release.`);
  if (isProduction && expiredWaivers > 0) {
    warnings.push(`${expiredWaivers} expired waiver(s) must be renewed or removed before production release.`);
  }
  return warnings;
}

function readinessStatus(
  missingRequired: string[],
  missingRecommended: string[],
  blocking: number,
  nonBlocking: number,
  productionBlockers: number,
): ReadinessScore["status"] {
  if (missingRequired.length > 0 || blocking > 0 || productionBlockers > 0) return "blocked";
  if (missingRecommended.length > 0 || nonBlocking > 0) return "at-risk";
  return "ready";
}

function readinessEvidence(
  required: string[],
  recommended: string[],
  presentOutputs: Set<string>,
): ReadinessEvidence[] {
  return [
    ...required.map((output) => ({ output, importance: "required" as const, present: presentOutputs.has(output) })),
    ...recommended.map((output) => ({
      output,
      importance: "recommended" as const,
      present: presentOutputs.has(output),
    })),
  ].sort((left, right) => left.output.localeCompare(right.output));
}

export function computeReadiness(input: ReadinessInput): ReadinessScore {
  const isProduction = input.releaseMode === "production";
  const { required, recommended } = normalizedOutputs(input);
  const missingRequired = required.filter((output) => !input.presentOutputs.has(output));
  const missingRecommended = recommended.filter((output) => !input.presentOutputs.has(output));
  const expiredWaivers = input.expiredWaivers ?? 0;
  const { blocking, nonBlocking } = countFindings(input.findings, input.failOn);
  const warnings = readinessWarnings(missingRequired, missingRecommended, blocking, isProduction, expiredWaivers);
  const productionBlockers = isProduction ? missingRecommended.length + expiredWaivers : 0;
  const score = clampScore(
    100 -
      missingRequired.length * REQUIRED_PENALTY -
      missingRecommended.length * RECOMMENDED_PENALTY -
      blocking * BLOCKING_PENALTY -
      nonBlocking * NON_BLOCKING_PENALTY -
      productionBlockers * REQUIRED_PENALTY,
  );

  return {
    profile: input.profile,
    score,
    status: readinessStatus(missingRequired, missingRecommended, blocking, nonBlocking, productionBlockers),
    blocking,
    nonBlocking,
    evidence: readinessEvidence(required, recommended, input.presentOutputs),
    missingRequired,
    missingRecommended,
    warnings,
  };
}
