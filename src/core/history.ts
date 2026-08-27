/**
 * Release history and readiness trend analysis.
 *
 * Aggregates a series of RunResult objects (ordered chronologically) into
 * a trend summary covering:
 * - Readiness score over time
 * - Recurring blockers and most frequent rule categories
 * - Waiver usage (active, expiring, expired) over time
 * - Artifact generation health (which evidence kinds appeared in each run)
 *
 * All computation is pure — no I/O, no side effects.
 * Callers can feed the output to dashboard APIs, report emitters, or CLI
 * diff commands.
 */

import type { RunResult } from "./result.js";

/** Readiness score snapshot for a single run. */
interface ReadinessDataPoint {
  /** ISO-8601 timestamp of the run. */
  generatedAt: string;
  /** Readiness score 0–100, or null if the run produced no readiness data. */
  score: number | null;
  /** Readiness status, or null if absent. */
  status: "ready" | "at-risk" | "blocked" | null;
  /** Whether the run passed the configured fail-on threshold. */
  passed: boolean;
}

/** A finding rule that appeared in multiple runs. */
interface RecurringFinding {
  ruleId: string;
  /** Number of runs in which this rule fired at least once. */
  runCount: number;
  /** Total finding count across all runs (may be > runCount if multiple per run). */
  totalCount: number;
  /** Maximum severity seen across all instances. */
  maxSeverity: string;
}

/** Waiver usage statistics for a single run. */
interface WaiverDataPoint {
  generatedAt: string;
  activeCount: number;
  expiredCount: number;
}

/** Artifact (evidence kind) presence across runs. */
interface ArtifactHealthDataPoint {
  generatedAt: string;
  /** Set of output kinds detected in this run's fabrication snapshot. */
  presentKinds: string[];
}

/** Aggregate trend summary for a series of runs. */
export interface ReleaseTrend {
  /** Total number of runs analysed. */
  runCount: number;
  /** Earliest run timestamp in the series. */
  from: string | null;
  /** Latest run timestamp in the series. */
  to: string | null;
  /** Readiness score time-series (one entry per run). */
  readiness: ReadinessDataPoint[];
  /** Rules that fired in more than one run, sorted by runCount descending. */
  recurringFindings: RecurringFinding[];
  /** Waiver usage time-series (one entry per run, only runs with waiver data). */
  waivers: WaiverDataPoint[];
  /** Artifact health time-series (one entry per run). */
  artifactHealth: ArtifactHealthDataPoint[];
  /** Whether readiness score is trending upward, downward, or flat. */
  scoreTrend: "improving" | "degrading" | "flat" | "insufficient-data";
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Compute the score trend direction over the provided series.
 *
 * Uses the first and last non-null score in the series. Returns
 * "insufficient-data" when fewer than 2 runs have a readiness score.
 */
function computeScoreTrend(points: ReadinessDataPoint[]): ReleaseTrend["scoreTrend"] {
  const scores = points.map((point) => point.score).filter((score): score is number => score !== null);
  const [first] = scores;
  const last = scores.at(-1);
  if (first === undefined || last === undefined || scores.length < 2) {
    return "insufficient-data";
  }
  const delta = last - first;
  if (delta > 2) return "improving";
  if (delta < -2) return "degrading";
  return "flat";
}

/**
 * Build a `ReleaseTrend` from an ordered array of run results.
 *
 * @param runs  RunResult objects in chronological order (oldest first).
 */
export function buildReleaseTrends(runs: RunResult[]): ReleaseTrend {
  const [firstRun] = runs;
  if (firstRun === undefined) {
    return {
      runCount: 0,
      from: null,
      to: null,
      readiness: [],
      recurringFindings: [],
      waivers: [],
      artifactHealth: [],
      scoreTrend: "insufficient-data",
    };
  }
  const lastRun = runs.at(-1) ?? firstRun;

  const readiness: ReadinessDataPoint[] = runs.map((run) => ({
    generatedAt: run.generatedAt,
    score: run.readiness?.score ?? null,
    status: run.readiness?.status ?? null,
    passed: run.status === "passed",
  }));

  const recurringFindings = buildRecurringFindings(runs);
  const waivers: WaiverDataPoint[] = runs
    .filter((run): run is RunResult & { waivers: NonNullable<RunResult["waivers"]> } => run.waivers !== undefined)
    .map((run) => ({
      generatedAt: run.generatedAt,
      activeCount: run.waivers.active.length,
      expiredCount: run.waivers.expired.length,
    }));

  const artifactHealth: ArtifactHealthDataPoint[] = runs.map((run) => ({
    generatedAt: run.generatedAt,
    presentKinds: [...new Set(run.fabrication.outputs.map((output) => output.kind))].sort((left, right) =>
      left.localeCompare(right),
    ),
  }));

  return {
    runCount: runs.length,
    from: firstRun.generatedAt,
    to: lastRun.generatedAt,
    readiness,
    recurringFindings,
    waivers,
    artifactHealth,
    scoreTrend: computeScoreTrend(readiness),
  };
}

function processRunFindings(
  run: RunResult,
  ruleTotalCounts: Map<string, number>,
  ruleMaxSeverity: Map<string, string>,
): Set<string> {
  const rulesThisRun = new Set<string>();
  for (const finding of run.findings) {
    if (finding.suppressed) {
      continue;
    }
    rulesThisRun.add(finding.ruleId);
    ruleTotalCounts.set(finding.ruleId, (ruleTotalCounts.get(finding.ruleId) ?? 0) + 1);
    const current = ruleMaxSeverity.get(finding.ruleId);
    const currentRank = current ? SEVERITY_RANK[current] || 0 : -1;
    const newRank = SEVERITY_RANK[finding.severity] || 0;
    if (newRank > currentRank) {
      ruleMaxSeverity.set(finding.ruleId, finding.severity);
    }
  }
  return rulesThisRun;
}

function buildRecurringFindings(runs: RunResult[]): RecurringFinding[] {
  const ruleRunCounts = new Map<string, number>();
  const ruleTotalCounts = new Map<string, number>();
  const ruleMaxSeverity = new Map<string, string>();

  for (const run of runs) {
    const rulesThisRun = processRunFindings(run, ruleTotalCounts, ruleMaxSeverity);
    for (const ruleId of rulesThisRun) {
      ruleRunCounts.set(ruleId, (ruleRunCounts.get(ruleId) || 0) + 1);
    }
  }

  return [...ruleRunCounts.entries()]
    .filter(([, runCount]) => runCount > 1)
    .map(([ruleId, runCount]) => ({
      ruleId,
      runCount,
      totalCount: ruleTotalCounts.get(ruleId) ?? 0,
      maxSeverity: ruleMaxSeverity.get(ruleId) ?? "info",
    }))
    .sort((left, right) => right.runCount - left.runCount || left.ruleId.localeCompare(right.ruleId));
}
