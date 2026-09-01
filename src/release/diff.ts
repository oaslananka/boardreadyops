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
    bomChanged: fabrication.bom.addedCount + fabrication.bom.removedCount + fabrication.bom.changedCount,
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

  lines.push(
    ...bomRowChangeLines(diff.fabrication.bom),
    ...outputChangeLines(diff.fabrication.outputs),
    ...findingChangeLines("new findings", diff.fabrication.findings.added),
    ...findingChangeLines("resolved findings", diff.fabrication.findings.removed),
  );

  return `${lines.join("\n")}\n`;
}

const MAX_DETAIL_LINES = 20;

function bomRowChangeLines(bom: FabricationDiff["bom"]): string[] {
  const changedRows = bom.rows.filter((row) => row.status !== "unchanged");
  if (changedRows.length === 0) return [];

  const shown = changedRows.slice(0, MAX_DETAIL_LINES);
  const lines = ["  bom row changes:", ...shown.map((row) => `    - ${bomRowSummary(row)}`)];

  // bom.rows can itself already be capped (see FabricationDiffOptions.maxBomRows), so the
  // added/removed/changed counts -- computed before that cap -- are the only accurate source
  // for how many rows remain.
  const totalChanged = bom.addedCount + bom.removedCount + bom.changedCount;
  const remaining = totalChanged - shown.length;
  if (remaining > 0) {
    lines.push(`    - (+${remaining} more)`);
  }
  return lines;
}

function outputChangeLines(outputs: FabricationDiff["outputs"]): string[] {
  const changedOutputs = outputs.filter((output) => output.status !== "unchanged");
  if (changedOutputs.length === 0) return [];

  return [
    "  output changes:",
    ...changedOutputs.map(
      (output) => `    - ${output.kind}: ${output.status} (+${output.added} -${output.removed} ~${output.changed})`,
    ),
  ];
}

function findingChangeLines(label: string, findings: readonly Finding[]): string[] {
  if (findings.length === 0) return [];

  const summaries = withOverflowNote(findings.map(findingSummary), MAX_DETAIL_LINES);
  return [`  ${label}:`, ...summaries.map((line) => `    - ${line}`)];
}

function findingSummary(finding: Finding): string {
  return `${finding.severity} ${finding.ruleId} at ${finding.resource.path}`;
}

function bomRowSummary(row: { reference: string; previous: string; current: string; status: string }): string {
  if (row.status === "added") return `${row.reference}: added (${row.current})`;
  if (row.status === "removed") return `${row.reference}: removed (was ${row.previous})`;
  return `${row.reference}: ${row.previous} -> ${row.current}`;
}

function withOverflowNote(lines: readonly string[], max: number): string[] {
  if (lines.length <= max) return [...lines];
  return [...lines.slice(0, max), `(+${lines.length - max} more)`];
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "n/a" : `${score}`;
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
