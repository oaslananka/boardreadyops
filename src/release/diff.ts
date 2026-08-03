import { diffFabrication, type FabricationDiff, type FabricationSnapshot } from "../core/diff/fabrication.js";
import type { Finding } from "../core/findings.js";
import type { ReadinessScore } from "../core/readiness.js";
import { boardReadyVersion } from "../generated/version.js";

export interface ReleaseSnapshot {
  fabrication: FabricationSnapshot;
  findings: Finding[];
  readiness?: ReadinessScore | undefined;
}

interface ReleaseReadinessDiff {
  previousScore?: number | undefined;
  currentScore?: number | undefined;
  scoreDelta: number;
  previousStatus?: ReadinessScore["status"] | undefined;
  currentStatus?: ReadinessScore["status"] | undefined;
  statusChanged: boolean;
  newlyMissingRequired: string[];
  resolvedRequired: string[];
}

interface ReleaseDiffSummary {
  bomChanged: number;
  outputsChanged: number;
  findingsAdded: number;
  findingsRemoved: number;
  scoreDelta: number;
}

export interface ReleaseDiff {
  schemaVersion: 1;
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  fabrication: FabricationDiff;
  readiness: ReleaseReadinessDiff;
  summary: ReleaseDiffSummary;
}

export interface ReleaseDiffOptions {
  generatedAt?: string | undefined;
  maxBomRows?: number | undefined;
  toolVersion?: string | undefined;
}

export function diffReleases(
  previous: ReleaseSnapshot,
  current: ReleaseSnapshot,
  options: ReleaseDiffOptions = {},
): ReleaseDiff {
  const fabrication = diffFabrication(previous.fabrication, current.fabrication, previous.findings, current.findings, {
    ...(options.maxBomRows === undefined ? {} : { maxBomRows: options.maxBomRows }),
  });
  const readiness = diffReadiness(previous.readiness, current.readiness);
  const summary: ReleaseDiffSummary = {
    bomChanged: fabrication.bom.rows.filter((row) => row.status !== "unchanged").length,
    outputsChanged: fabrication.outputs.filter((output) => output.status !== "unchanged").length,
    findingsAdded: fabrication.findings.added.length,
    findingsRemoved: fabrication.findings.removed.length,
    scoreDelta: readiness.scoreDelta,
  };
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: options.toolVersion ?? boardReadyVersion },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    fabrication,
    readiness,
    summary,
  };
}

function diffReadiness(
  previous: ReadinessScore | undefined,
  current: ReadinessScore | undefined,
): ReleaseReadinessDiff {
  const previousScore = previous?.score;
  const currentScore = current?.score;
  const scoreDelta = (currentScore ?? 0) - (previousScore ?? 0);
  const previousMissing = new Set(previous?.missingRequired ?? []);
  const currentMissing = new Set(current?.missingRequired ?? []);
  return {
    previousScore,
    currentScore,
    scoreDelta,
    previousStatus: previous?.status,
    currentStatus: current?.status,
    statusChanged: previous?.status !== current?.status,
    newlyMissingRequired: [...currentMissing]
      .filter((output) => !previousMissing.has(output))
      .sort((a, b) => a.localeCompare(b)),
    resolvedRequired: [...previousMissing]
      .filter((output) => !currentMissing.has(output))
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function formatReleaseDiffText(diff: ReleaseDiff): string {
  const lines: string[] = [];
  lines.push("Release diff");
  lines.push(
    `  readiness: ${formatScore(diff.readiness.previousScore)} -> ${formatScore(diff.readiness.currentScore)} (${formatDelta(diff.readiness.scoreDelta)})`,
  );
  if (diff.readiness.statusChanged) {
    lines.push(`  status: ${diff.readiness.previousStatus ?? "n/a"} -> ${diff.readiness.currentStatus ?? "n/a"}`);
  }
  if (diff.readiness.newlyMissingRequired.length > 0) {
    lines.push(`  newly missing required: ${diff.readiness.newlyMissingRequired.join(", ")}`);
  }
  if (diff.readiness.resolvedRequired.length > 0) {
    lines.push(`  resolved required: ${diff.readiness.resolvedRequired.join(", ")}`);
  }
  lines.push(`  bom rows changed: ${diff.summary.bomChanged}`);
  lines.push(`  outputs changed: ${diff.summary.outputsChanged}`);
  lines.push(`  findings: +${diff.summary.findingsAdded} / -${diff.summary.findingsRemoved}`);
  return `${lines.join("\n")}\n`;
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "n/a" : `${score}`;
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
