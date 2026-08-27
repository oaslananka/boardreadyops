import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  EvidenceItem,
  EvidenceLedgerDocument,
  LedgerApprovalRecord,
  LedgerChecklistRecord,
  LedgerDecisionRecord,
  LedgerVerificationResult,
} from "@boardreadyops/contracts";
import type { RunResult } from "../core/result.js";
import { boardReadyVersion } from "../generated/version.js";
import { formatJson } from "../report/json.js";
import { formatMarkdown } from "../report/markdown.js";
import { normalizeRelative } from "../util/path.js";

interface ReleaseEvidenceArtifact {
  path: string;
  sourcePath?: string | undefined;
  kind: "report" | "fabrication" | "bom" | "cpl" | "drill" | "gerber" | "generated" | "other";
  sha256: string;
  bytes: number;
}

interface ReleaseEvidenceGap {
  kind: "missing-artifact" | "missing-project-file";
  path: string;
  message: string;
}

interface ReleaseEvidenceDecision {
  status: "pass" | "fail";
  reasons: string[];
}

interface ReleaseEvidenceVerificationMetadata {
  algorithm: "sha256";
  artifactCount: number;
}

interface ReleaseEvidenceManifest {
  schemaVersion: 2;
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  git: { sha?: string | undefined; dirty?: boolean | undefined };
  decision: ReleaseEvidenceDecision;
  summary: RunResult["summary"];
  projects: RunResult["projects"];
  layout: { reports: string; artifacts: string; generated: string };
  artifacts: ReleaseEvidenceArtifact[];
  gaps: ReleaseEvidenceGap[];
  provenance: { attestation?: string | undefined; source?: string | undefined };
  verification: ReleaseEvidenceVerificationMetadata;
}

export interface ReleaseEvidenceWriteOptions {
  outputDir: string;
  generatedAt?: string | undefined;
  gitSha?: string | undefined;
  gitDirty?: boolean | undefined;
  includeGenerated?: string | undefined;
  provenance?: { attestation?: string | undefined; source?: string | undefined } | undefined;
}

export interface ReleaseEvidenceWriteResult {
  outputDir: string;
  manifestPath: string;
  checksumsPath: string;
  manifest: ReleaseEvidenceManifest;
}

export interface ReleaseEvidenceVerification {
  ok: boolean;
  manifestPath: string;
  checked: number;
  errors: string[];
}

const FABRICATION_DIRS = ["fab", "fabrication", "manufacturing", "gerbers", "gerber", "production"];
const MANUFACTURING_EXTENSIONS = new Set([
  ".gbr",
  ".gbl",
  ".gtl",
  ".gbs",
  ".gts",
  ".gbo",
  ".gto",
  ".gm1",
  ".gko",
  ".drl",
  ".xln",
  ".pos",
  ".csv",
  ".tsv",
  ".xlsx",
  ".pdf",
  ".step",
  ".stp",
  ".zip",
]);

const BUNDLE_LAYOUT = { reports: "reports", artifacts: "artifacts", generated: "generated" } as const;

export async function writeReleaseEvidenceBundle(
  root: string,
  result: RunResult,
  options: ReleaseEvidenceWriteOptions,
): Promise<ReleaseEvidenceWriteResult> {
  const outputDir = path.resolve(root, options.outputDir);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDir, BUNDLE_LAYOUT.reports), { recursive: true });
  await fs.mkdir(path.join(outputDir, BUNDLE_LAYOUT.artifacts), { recursive: true });

  const artifacts: ReleaseEvidenceArtifact[] = [];
  artifacts.push(await writeReport(outputDir, "reports/boardreadyops-report.json", formatJson(result)));
  artifacts.push(await writeReport(outputDir, "reports/boardreadyops-report.md", formatMarkdown(result)));
  artifacts.push(...(await copyManufacturingArtifacts(root, outputDir)));
  if (options.includeGenerated) {
    artifacts.push(...(await copyGeneratedOutputs(root, outputDir, options.includeGenerated)));
  }
  artifacts.sort((left, right) => left.path.localeCompare(right.path));

  const gaps = evidenceGaps(root, result, artifacts).sort((left, right) =>
    `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`),
  );
  const manifest: ReleaseEvidenceManifest = {
    schemaVersion: 2,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    git: cleanObject({ sha: options.gitSha, dirty: options.gitDirty }),
    decision: evidenceDecision(result, gaps),
    summary: result.summary,
    projects: result.projects,
    layout: { ...BUNDLE_LAYOUT },
    artifacts,
    gaps,
    provenance: cleanObject(options.provenance ?? {}),
    verification: { algorithm: "sha256", artifactCount: artifacts.length },
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const checksumsPath = path.join(outputDir, "checksums.txt");
  await fs.writeFile(checksumsPath, formatChecksumsTxt(artifacts), "utf8");
  return { outputDir, manifestPath, checksumsPath, manifest };
}

function evidenceDecision(result: RunResult, gaps: ReleaseEvidenceGap[]): ReleaseEvidenceDecision {
  const reasons: string[] = [];
  if (result.summary.failed) {
    reasons.push(`validation reported ${result.summary.total} finding(s) (max severity ${result.summary.maxSeverity})`);
  }
  if (gaps.length > 0) {
    reasons.push(`bundle has ${gaps.length} evidence gap(s) requiring review`);
  }
  return { status: result.summary.failed ? "fail" : "pass", reasons };
}

function formatChecksumsTxt(artifacts: ReleaseEvidenceArtifact[]): string {
  return `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join("\n")}\n`;
}

export interface ReleaseManifestCoverage {
  ok: boolean;
  manifestPath: string;
  uncovered: string[];
  errors: string[];
}

/** Verify that every file inside the bundle directory (excluding manifest.json and checksums.txt) appears in the manifest. */
export async function verifyManifestCoverage(bundleDir: string): Promise<ReleaseManifestCoverage> {
  const outputDir = path.resolve(bundleDir);
  const manifestPath = path.join(outputDir, "manifest.json");
  const readResult = await readBundleManifest(manifestPath);
  if (!readResult.ok) {
    return { ok: false, manifestPath, uncovered: [], errors: readResult.errors };
  }
  const manifest = readResult.manifest;
  const covered = new Set((manifest.artifacts ?? []).map((artifact) => path.resolve(outputDir, artifact.path)));
  const SKIP = new Set(["manifest.json", "checksums.txt", "manifest.sig"]);
  const allFiles: string[] = [];
  await collectFiles(outputDir, allFiles);
  const uncovered = allFiles
    .filter((file) => !SKIP.has(path.basename(file)) && !covered.has(file))
    .map((file) => path.relative(outputDir, file).split(path.sep).join("/"))
    .sort((left, right) => left.localeCompare(right));
  return { ok: uncovered.length === 0, manifestPath, uncovered, errors: [] };
}

export async function verifyReleaseEvidenceBundle(bundleDir: string): Promise<ReleaseEvidenceVerification> {
  const outputDir = path.resolve(bundleDir);
  const manifestPath = path.join(outputDir, "manifest.json");
  const readResult = await readBundleManifest(manifestPath);
  if (!readResult.ok) {
    return { ok: false, manifestPath, checked: 0, errors: readResult.errors };
  }
  const manifest = readResult.manifest;
  const errors: string[] = [];
  for (const artifact of manifest.artifacts ?? []) {
    const artifactPath = path.resolve(outputDir, artifact.path);
    if (!isInside(outputDir, artifactPath)) {
      errors.push(`${artifact.path}: path escapes bundle directory`);
      continue;
    }
    try {
      const actual = await fileDigest(artifactPath);
      if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) {
        errors.push(`${artifact.path}: checksum or size mismatch`);
      }
    } catch (error) {
      errors.push(`${artifact.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: errors.length === 0, manifestPath, checked: manifest.artifacts?.length ?? 0, errors };
}

async function readBundleManifest(
  manifestPath: string,
): Promise<{ ok: true; manifest: ReleaseEvidenceManifest } | { ok: false; errors: string[] }> {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ReleaseEvidenceManifest;
    return { ok: true, manifest };
  } catch (error) {
    return {
      ok: false,
      errors: [`manifest could not be read: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

async function writeReport(outputDir: string, relativePath: string, content: string): Promise<ReleaseEvidenceArtifact> {
  const target = path.join(outputDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  const digest = await fileDigest(target);
  return { path: relativePath, kind: "report", ...digest };
}

async function copyManufacturingArtifacts(root: string, outputDir: string): Promise<ReleaseEvidenceArtifact[]> {
  const files = await discoverManufacturingArtifacts(root);
  const artifacts: ReleaseEvidenceArtifact[] = [];
  for (const source of files) {
    const relativeSource = normalizeRelative(root, source);
    const targetRelative = path.join("artifacts", relativeSource).split(path.sep).join("/");
    const target = path.join(outputDir, targetRelative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    const digest = await fileDigest(target);
    artifacts.push({ path: targetRelative, sourcePath: relativeSource, kind: artifactKind(source), ...digest });
  }
  return artifacts;
}

async function copyGeneratedOutputs(
  root: string,
  outputDir: string,
  includeGenerated: string,
): Promise<ReleaseEvidenceArtifact[]> {
  const sourceDir = path.resolve(root, includeGenerated);
  if (sourceDir === outputDir || isInside(outputDir, sourceDir) || isInside(sourceDir, outputDir)) {
    return [];
  }
  const files: string[] = [];
  await collectFiles(sourceDir, files);
  files.sort((left, right) => left.localeCompare(right));
  const artifacts: ReleaseEvidenceArtifact[] = [];
  for (const source of files) {
    const relativeSource = normalizeRelative(sourceDir, source);
    const targetRelative = path.join(BUNDLE_LAYOUT.generated, relativeSource).split(path.sep).join("/");
    const target = path.join(outputDir, targetRelative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    const digest = await fileDigest(target);
    artifacts.push({
      path: targetRelative,
      sourcePath: normalizeRelative(root, source),
      kind: "generated",
      ...digest,
    });
  }
  return artifacts;
}

async function discoverManufacturingArtifacts(root: string): Promise<string[]> {
  const discovered: string[] = [];
  for (const directory of FABRICATION_DIRS) {
    await collectFiles(path.join(root, directory), discovered);
  }
  return [...new Set(discovered)]
    .filter(
      (file) =>
        MANUFACTURING_EXTENSIONS.has(path.extname(file).toLowerCase()) ||
        path.basename(file).toLowerCase().includes("readme"),
    )
    .sort((left, right) => left.localeCompare(right));
}

async function collectFiles(directory: string, output: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(target, output);
    } else if (entry.isFile()) {
      output.push(target);
    }
  }
}

function evidenceGaps(root: string, result: RunResult, artifacts: ReleaseEvidenceArtifact[]): ReleaseEvidenceGap[] {
  const gaps: ReleaseEvidenceGap[] = [];
  for (const project of result.projects) {
    if (project.boardFiles.length === 0) {
      gaps.push({
        kind: "missing-project-file",
        path: project.root,
        message: "Project has no discovered KiCad PCB file.",
      });
    }
    if (project.schematicFiles.length === 0) {
      gaps.push({
        kind: "missing-project-file",
        path: project.root,
        message: "Project has no discovered KiCad schematic file.",
      });
    }
  }
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  for (const [kind, message] of [
    ["gerber", "No Gerber fabrication output was included in the evidence bundle."],
    ["drill", "No drill output was included in the evidence bundle."],
    ["bom", "No BOM output was included in the evidence bundle."],
    ["cpl", "No component placement output was included in the evidence bundle."],
  ] as const) {
    if (!kinds.has(kind)) {
      gaps.push({ kind: "missing-artifact", path: root, message });
    }
  }
  return gaps;
}

function artifactKind(file: string): ReleaseEvidenceArtifact["kind"] {
  const lower = path.basename(file).toLowerCase();
  const extension = path.extname(lower);
  if (extension === ".drl" || extension === ".xln") {
    return "drill";
  }
  if (extension.startsWith(".g") || lower.includes("gerber")) {
    return "gerber";
  }
  if (lower.includes("bom") || lower.includes("bill-of-materials")) {
    return "bom";
  }
  if (lower.includes("cpl") || lower.includes("pos") || lower.includes("centroid")) {
    return "cpl";
  }
  if (FABRICATION_DIRS.some((name) => file.split(path.sep).includes(name))) {
    return "fabrication";
  }
  return "other";
}

async function fileDigest(file: string): Promise<{ sha256: string; bytes: number }> {
  const content = await fs.readFile(file);
  return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength };
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(",")}]`;
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJsonStringify(val)}`;
  });
  return `{${pairs.join(",")}}`;
}

export function calculateEvidenceDigest(params: {
  manifest: EvidenceItem[];
  decisions: LedgerDecisionRecord[];
  approvals: LedgerApprovalRecord[];
  checklist: LedgerChecklistRecord[];
}): string {
  const sortedManifest = [...params.manifest].sort((a, b) => a.path.localeCompare(b.path));
  const sortedDecisions = [...params.decisions].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const sortedApprovals = [...params.approvals].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const sortedChecklist = [...params.checklist].sort((a, b) => a.id.localeCompare(b.id));

  const composite = {
    manifest: sortedManifest.map((m) => ({
      name: m.name,
      path: m.path,
      type: m.type,
      sizeBytes: m.sizeBytes,
      sha256: m.sha256,
    })),
    decisions: sortedDecisions.map((d) => ({
      fingerprint: d.fingerprint,
      disposition: d.disposition,
      reason: d.reason,
      owner: d.owner,
      expiresAt: d.expiresAt ?? null,
      timestamp: d.timestamp,
    })),
    approvals: sortedApprovals.map((a) => ({
      approverId: a.approverId,
      status: a.status,
      reason: a.reason ?? "",
      isBreakGlass: a.isBreakGlass ?? false,
      timestamp: a.timestamp,
    })),
    checklist: sortedChecklist.map((c) => ({
      id: c.id,
      title: c.title,
      completed: c.completed,
      completedBy: c.completedBy ?? "",
      completedAt: c.completedAt ?? "",
    })),
  };

  const canonical = canonicalJsonStringify(composite);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function writeReviewEvidenceLedger(options: {
  outputDir: string;
  repository: string;
  baseSha: string;
  headSha: string;
  manifest: EvidenceItem[];
  decisions: LedgerDecisionRecord[];
  approvals: LedgerApprovalRecord[];
  checklist: LedgerChecklistRecord[];
  evidenceState?: "current" | "stale" | "invalid";
}): Promise<{ ledgerPath: string; manifestPath: string; evidenceDigest: string }> {
  await fs.mkdir(options.outputDir, { recursive: true });

  const evidenceDigest = calculateEvidenceDigest({
    manifest: options.manifest,
    decisions: options.decisions,
    approvals: options.approvals,
    checklist: options.checklist,
  });

  const ledgerDoc: EvidenceLedgerDocument = {
    version: 1,
    repository: options.repository,
    baseSha: options.baseSha,
    headSha: options.headSha,
    evidenceState: options.evidenceState ?? "current",
    evidenceDigest,
    manifest: options.manifest,
    decisions: options.decisions,
    approvals: options.approvals,
    checklist: options.checklist,
    createdAt: new Date().toISOString(),
  };

  const ledgerPath = path.join(options.outputDir, "evidence-ledger.json");
  const manifestPath = path.join(options.outputDir, "manifest.json");

  await fs.writeFile(ledgerPath, JSON.stringify(ledgerDoc, null, 2), "utf8");
  await fs.writeFile(manifestPath, JSON.stringify(options.manifest, null, 2), "utf8");

  return { ledgerPath, manifestPath, evidenceDigest };
}

export async function verifyReviewEvidenceOffline(
  ledgerFilePath: string,
  artifactsRootDir?: string,
): Promise<LedgerVerificationResult> {
  const content = await fs.readFile(ledgerFilePath, "utf8");
  const ledgerDoc = JSON.parse(content) as EvidenceLedgerDocument;

  const fileHashes: Record<string, string> = {};
  const baseDir = artifactsRootDir ?? path.dirname(ledgerFilePath);

  for (const item of ledgerDoc.manifest) {
    const candidatePaths = [
      path.resolve(baseDir, item.path),
      path.resolve(baseDir, item.name),
      path.resolve(baseDir, "artifacts", item.name),
      path.resolve(baseDir, "artifacts", item.path),
    ];

    for (const candidate of candidatePaths) {
      try {
        const fileContent = await fs.readFile(candidate);
        const hash = createHash("sha256").update(fileContent).digest("hex");
        fileHashes[item.path] = hash;
        fileHashes[item.name] = hash;
        break;
      } catch {
        // Continue searching
      }
    }
  }

  const tamperedItems: string[] = [];
  const missingItems: string[] = [];
  const errors: string[] = [];

  let manifestCheckPassed = true;
  for (const item of ledgerDoc.manifest) {
    const actualHash = fileHashes[item.path] ?? fileHashes[item.name];
    if (!actualHash) {
      missingItems.push(item.path);
      manifestCheckPassed = false;
    } else if (actualHash.toLowerCase() !== item.sha256.toLowerCase()) {
      tamperedItems.push(`${item.path} (expected ${item.sha256.slice(0, 8)}..., got ${actualHash.slice(0, 8)}...)`);
      manifestCheckPassed = false;
    }
  }

  const calculatedDigest = calculateEvidenceDigest({
    manifest: ledgerDoc.manifest,
    decisions: ledgerDoc.decisions,
    approvals: ledgerDoc.approvals,
    checklist: ledgerDoc.checklist,
  });

  if (calculatedDigest !== ledgerDoc.evidenceDigest) {
    errors.push(
      `Evidence digest mismatch: calculated ${calculatedDigest.slice(0, 12)}... but document specifies ${ledgerDoc.evidenceDigest.slice(0, 12)}...`,
    );
  }

  for (const d of ledgerDoc.decisions) {
    if (d.disposition === "accepted_risk" && d.reason.trim().length < 20) {
      errors.push(`Invalid decision on ${d.fingerprint.slice(0, 8)}: accepted_risk requires min 20 char reason.`);
    }
  }

  const verified = manifestCheckPassed && calculatedDigest === ledgerDoc.evidenceDigest && errors.length === 0;

  return {
    verified,
    calculatedDigest,
    expectedDigest: ledgerDoc.evidenceDigest,
    manifestCheckPassed,
    tamperedItems,
    missingItems,
    errors,
  };
}
