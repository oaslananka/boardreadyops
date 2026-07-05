/**
 * Cross-run diff for hardware release candidates.
 *
 * Compares two RunResult objects and produces a structured diff covering:
 * - Readiness score and status delta
 * - Conclusion changes (passed → failed, failed → passed)
 * - New, resolved, and unchanged findings
 * - BOM and fabrication output changes (reuses FabricationDiff)
 * - Release mode changes
 *
 * This module has no I/O — it operates on in-memory RunResult objects so
 * callers can use it from CLI commands, report emitters, or dashboard APIs.
 */

import type { Finding } from "../findings.js";
import type { RunResult } from "../result.js";
import { diffFabrication, type FabricationDiff, type FabricationDiffOptions } from "./fabrication.js";

/** Delta in readiness score and status between two runs. */
interface ReadinessDelta {
  /** Previous readiness score (0–100), or null if absent. */
  previousScore: number | null;
  /** Current readiness score (0–100), or null if absent. */
  currentScore: number | null;
  /** Numeric delta (current − previous), or null if either score is absent. */
  scoreDelta: number | null;
  /** Previous status, or null if absent. */
  previousStatus: "ready" | "at-risk" | "blocked" | null;
  /** Current status, or null if absent. */
  currentStatus: "ready" | "at-risk" | "blocked" | null;
  /** Whether the overall release conclusion changed (pass/fail). */
  conclusionChanged: boolean;
  /** True when risk increased (score went down or status worsened). */
  riskIncreased: boolean;
}

/** Lightweight finding representation used in diff output. */
interface FindingRef {
  fingerprint: string;
  ruleId: string;
  severity: string;
  message: string;
  resourcePath: string;
}

/** New, resolved, and unchanged finding sets. */
interface FindingsDelta {
  /** Findings present in current but absent in previous (new risk introduced). */
  added: FindingRef[];
  /** Findings present in previous but absent in current (risk resolved). */
  resolved: FindingRef[];
  /** Findings present in both runs. */
  unchanged: FindingRef[];
}

/** Top-level diff between two runs. */
export interface RunDiff {
  /** ISO-8601 timestamp of the previous run. */
  previousGeneratedAt: string;
  /** ISO-8601 timestamp of the current run. */
  currentGeneratedAt: string;
  /** Release mode of the previous run. */
  previousReleaseMode: string | null;
  /** Release mode of the current run. */
  currentReleaseMode: string | null;
  readiness: ReadinessDelta;
  findings: FindingsDelta;
  fabrication: FabricationDiff;
}

export interface RunDiffOptions extends FabricationDiffOptions {}

/**
 * Compare two RunResult objects and return a structured diff.
 *
 * @param previous  The baseline run (e.g. the previous release candidate).
 * @param current   The candidate run (e.g. the new PR or release candidate).
 * @param options   Optional tuning parameters (e.g. maxBomRows).
 */
export function diffRuns(previous: RunResult, current: RunResult, options: RunDiffOptions = {}): RunDiff {
  return {
    previousGeneratedAt: previous.generatedAt,
    currentGeneratedAt: current.generatedAt,
    previousReleaseMode: previous.releaseMode ?? null,
    currentReleaseMode: current.releaseMode ?? null,
    readiness: buildReadinessDelta(previous, current),
    findings: buildFindingsDelta(previous.findings, current.findings),
    fabrication: diffFabrication(
      previous.fabrication,
      current.fabrication,
      previous.findings,
      current.findings,
      options,
    ),
  };
}

function buildReadinessDelta(previous: RunResult, current: RunResult): ReadinessDelta {
  const previousScore = previous.readiness?.score ?? null;
  const currentScore = current.readiness?.score ?? null;
  const scoreDelta = previousScore !== null && currentScore !== null ? currentScore - previousScore : null;
  const previousStatus = previous.readiness?.status ?? null;
  const currentStatus = current.readiness?.status ?? null;

  const statusRank: Record<"ready" | "at-risk" | "blocked", number> = {
    ready: 0,
    "at-risk": 1,
    blocked: 2,
  };
  const previousStatusRank = previousStatus !== null ? statusRank[previousStatus] : null;
  const currentStatusRank = currentStatus !== null ? statusRank[currentStatus] : null;

  const conclusionChanged = previous.status !== current.status;
  const riskIncreased =
    (scoreDelta !== null && scoreDelta < 0) ||
    (previousStatusRank !== null && currentStatusRank !== null && currentStatusRank > previousStatusRank);

  return {
    previousScore,
    currentScore,
    scoreDelta,
    previousStatus,
    currentStatus,
    conclusionChanged,
    riskIncreased,
  };
}

function toFindingRef(finding: Finding): FindingRef {
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    resourcePath: finding.resource.path,
  };
}

function buildFindingsDelta(previous: Finding[], current: Finding[]): FindingsDelta {
  const previousByFingerprint = new Map(previous.map((finding) => [finding.fingerprint, finding]));
  const currentByFingerprint = new Map(current.map((finding) => [finding.fingerprint, finding]));

  return {
    added: current.filter((finding) => !previousByFingerprint.has(finding.fingerprint)).map(toFindingRef),
    resolved: previous.filter((finding) => !currentByFingerprint.has(finding.fingerprint)).map(toFindingRef),
    unchanged: current.filter((finding) => previousByFingerprint.has(finding.fingerprint)).map(toFindingRef),
  };
}
