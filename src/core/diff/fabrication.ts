import type { Finding } from "../findings.js";

interface FabricationBomEntry {
  reference: string;
  sourcePath?: string | undefined;
  value?: string | undefined;
  footprint?: string | undefined;
  manufacturer?: string | undefined;
  mpn?: string | undefined;
  suppliers?: string[] | undefined;
  lifecycle?: string | undefined;
  dnp?: boolean | undefined;
  quantity?: number | undefined;
  compliance?: string | undefined;
}

interface FabricationOutputFile {
  path: string;
  digest: string;
}

interface FabricationOutput {
  kind: string;
  files: FabricationOutputFile[];
}

export interface FabricationSnapshot {
  bom: FabricationBomEntry[];
  outputs: FabricationOutput[];
}

export interface FabricationBomDiffRow {
  reference: string;
  previous: string;
  current: string;
  status: "added" | "removed" | "changed" | "unchanged";
}

interface FabricationBomDiff {
  rows: FabricationBomDiffRow[];
  truncated: boolean;
  changedCount: number;
}

export interface FabricationOutputDiff {
  kind: string;
  status: "added" | "removed" | "changed" | "unchanged";
  changed: number;
  added: number;
  removed: number;
}

interface FabricationFindingDiff {
  added: Finding[];
  removed: Finding[];
  unchanged: Finding[];
}

export interface FabricationDiff {
  bom: FabricationBomDiff;
  outputs: FabricationOutputDiff[];
  findings: FabricationFindingDiff;
}

export interface FabricationDiffOptions {
  maxBomRows?: number | undefined;
}

export function diffFabrication(
  previous: FabricationSnapshot | undefined,
  current: FabricationSnapshot,
  previousFindings: Finding[],
  currentFindings: Finding[],
  options: FabricationDiffOptions = {},
): FabricationDiff {
  return {
    bom: diffBom(previous?.bom ?? [], current.bom, options.maxBomRows ?? 20),
    outputs: diffOutputs(previous?.outputs ?? [], current.outputs),
    findings: diffFindings(previousFindings, currentFindings),
  };
}

function diffBom(previous: FabricationBomEntry[], current: FabricationBomEntry[], maxRows: number): FabricationBomDiff {
  const previousRows = new Map(previous.map((row) => [bomRowKey(row), row]));
  const currentRows = new Map(current.map((row) => [bomRowKey(row), row]));
  const rowKeys = [...new Set([...previousRows.keys(), ...currentRows.keys()])].sort((a, b) => a.localeCompare(b));
  const rows = rowKeys.map((rowKey) => {
    const prior = previousRows.get(rowKey);
    const next = currentRows.get(rowKey);
    const previousText = prior ? describeBomRow(prior) : "";
    const currentText = next ? describeBomRow(next) : "";
    return {
      reference: (next ?? prior)?.reference ?? rowKey,
      previous: previousText,
      current: currentText,
      status: bomStatus(prior, next),
    };
  });
  rows.sort(compareBomDiffRows);
  return {
    rows: rows.slice(0, Math.max(0, maxRows)),
    truncated: rows.length > maxRows,
    changedCount: rows.filter((row) => row.status !== "unchanged").length,
  };
}

function diffOutputs(previous: FabricationOutput[], current: FabricationOutput[]): FabricationOutputDiff[] {
  const previousOutputs = new Map(previous.map((output) => [output.kind, output]));
  const currentOutputs = new Map(current.map((output) => [output.kind, output]));
  return [...new Set([...previousOutputs.keys(), ...currentOutputs.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((kind) => outputDiff(kind, previousOutputs.get(kind), currentOutputs.get(kind)));
}

function diffFindings(previous: Finding[], current: Finding[]): FabricationFindingDiff {
  const previousFingerprints = new Map(previous.map((finding) => [finding.fingerprint, finding]));
  const currentFingerprints = new Map(current.map((finding) => [finding.fingerprint, finding]));
  return {
    added: current.filter((finding) => !previousFingerprints.has(finding.fingerprint)),
    removed: previous.filter((finding) => !currentFingerprints.has(finding.fingerprint)),
    unchanged: current.filter((finding) => previousFingerprints.has(finding.fingerprint)),
  };
}

function describeBomRow(row: FabricationBomEntry): string {
  return [row.mpn ?? row.value, row.footprint].filter(Boolean).join(" ");
}

function bomStatus(
  previous: FabricationBomEntry | undefined,
  current: FabricationBomEntry | undefined,
): FabricationBomDiffRow["status"] {
  if (!previous) {
    return "added";
  }
  if (!current) {
    return "removed";
  }
  return bomFingerprint(previous) === bomFingerprint(current) ? "unchanged" : "changed";
}

function bomRowKey(row: FabricationBomEntry): string {
  return `${row.sourcePath ?? ""}\u0000${row.reference}`;
}

function bomFingerprint(row: FabricationBomEntry): string {
  return JSON.stringify([
    row.value,
    row.footprint,
    row.manufacturer,
    row.mpn,
    row.suppliers ?? [],
    row.lifecycle,
    row.dnp,
    row.quantity,
  ]);
}

function compareBomDiffRows(left: FabricationBomDiffRow, right: FabricationBomDiffRow): number {
  const signalOrder = Number(left.status === "unchanged") - Number(right.status === "unchanged");
  return signalOrder || left.reference.localeCompare(right.reference);
}

function outputDiff(
  kind: string,
  previous: FabricationOutput | undefined,
  current: FabricationOutput | undefined,
): FabricationOutputDiff {
  const priorFiles = new Map(previous?.files.map((file) => [file.path, file]) ?? []);
  const nextFiles = new Map(current?.files.map((file) => [file.path, file]) ?? []);
  const changed = [...priorFiles.keys()].filter(
    (file) => nextFiles.has(file) && nextFiles.get(file)?.digest !== priorFiles.get(file)?.digest,
  ).length;
  const added = [...nextFiles.keys()].filter((file) => !priorFiles.has(file)).length;
  const removed = [...priorFiles.keys()].filter((file) => !nextFiles.has(file)).length;
  return {
    kind,
    status: outputStatus(previous, current, changed, added, removed),
    changed,
    added,
    removed,
  };
}

function outputStatus(
  previous: FabricationOutput | undefined,
  current: FabricationOutput | undefined,
  changed: number,
  added: number,
  removed: number,
): FabricationOutputDiff["status"] {
  if (!previous) {
    return "added";
  }
  if (!current) {
    return "removed";
  }
  return changed > 0 || added > 0 || removed > 0 ? "changed" : "unchanged";
}
