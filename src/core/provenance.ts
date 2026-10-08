import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { boardReadyVersion } from "../generated/version.js";
import { readTextFile } from "../util/fs.js";
import { globFiles } from "../util/glob.js";
import { isInside, normalizeRelative, toPosixPath } from "../util/path.js";
import { checkFirstPartyOutputSet } from "./generated-output-inventory.js";

interface ProvenanceArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ExportProvenanceManifest {
  /** Optional for legacy export inventories; not an authenticated generator identity. */
  kind?: "boardreadyops.export-provenance" | undefined;
  schemaVersion: 1;
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  git?: { sha?: string | undefined; dirty?: boolean | undefined } | undefined;
  sourceFingerprint: string;
  /** A self-reported snapshot claim; never a trusted execution attestation. */
  sourceSnapshot?: "stable" | "changed" | undefined;
  artifacts: ProvenanceArtifact[];
}

export interface ProvenanceVerificationResult {
  status: "verified" | "mismatch" | "missing" | "unsupported";
  reasons: string[];
  sourceFingerprintMatch?: boolean | undefined;
  gitShaMatch?: boolean | undefined;
  artifactMismatches?: string[] | undefined;
  missingArtifacts?: string[] | undefined;
  manifest?: ExportProvenanceManifest | undefined;
}

const NO_SOURCE_INPUTS_REASON =
  "No KiCad source inputs were found; source-to-export consistency cannot be established.";

const SOURCE_PATTERNS = [
  "**/*.kicad_pcb",
  "**/*.kicad_sch",
  "**/*.kicad_pro",
  "**/*.kicad_jobset",
  "**/*.kicad_dru",
  "**/*.kicad_wks",
];

async function sourceFingerprintDetail(
  root: string,
  customPatterns: string[] = SOURCE_PATTERNS,
): Promise<{ fingerprint: string; sourceCount: number }> {
  const files = await globFiles(root, customPatterns);
  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));

  const hasher = createHash("sha256");
  for (const absolutePath of sortedFiles) {
    const relPath = normalizeRelative(root, absolutePath);
    // Missing or unreadable KiCad inputs cannot be represented as empty source bytes.
    const content = await fs.readFile(absolutePath);
    hasher.update(`${relPath}\0`, "utf8");
    hasher.update(content);
    hasher.update("\0", "utf8");
  }

  return { fingerprint: hasher.digest("hex"), sourceCount: sortedFiles.length };
}

export async function computeSourceFingerprint(
  root: string,
  customPatterns: string[] = SOURCE_PATTERNS,
): Promise<string> {
  return (await sourceFingerprintDetail(root, customPatterns)).fingerprint;
}

export async function createExportProvenanceManifest(options: {
  root: string;
  artifacts: Array<{ path: string; sha256: string; bytes: number }>;
  git?: { sha?: string | undefined; dirty?: boolean | undefined } | undefined;
  generatedAt?: string | undefined;
}): Promise<ExportProvenanceManifest> {
  const { fingerprint: sourceFingerprint, sourceCount } = await sourceFingerprintDetail(options.root);
  if (sourceCount === 0) throw new Error(NO_SOURCE_INPUTS_REASON);
  const sortedArtifacts = [...options.artifacts]
    .map((a) => ({
      path: toPosixPath(a.path).replace(/^\.\//, ""),
      sha256: a.sha256,
      bytes: a.bytes,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.git ? { git: options.git } : {}),
    sourceFingerprint,
    artifacts: sortedArtifacts,
  };
}

function compareReviewedCommit(
  reviewedSha: string,
  recorded: ExportProvenanceManifest["git"],
): { match: boolean; reason?: string } {
  if (typeof recorded?.sha !== "string" || !/^[0-9a-f]{40}$/i.test(recorded.sha)) {
    return { match: false, reason: "Reviewed commit verification requested, but manifest has no valid Git SHA." };
  }
  if (recorded.dirty === true) {
    return {
      match: false,
      reason: "Reviewed commit verification requested, but the export recorded a dirty source tree.",
    };
  }
  if (reviewedSha !== recorded.sha) {
    return {
      match: false,
      reason:
        "Git SHA mismatch: current commit " +
        reviewedSha.slice(0, 12) +
        "… but manifest recorded " +
        recorded.sha.slice(0, 12) +
        "…",
    };
  }
  return { match: true };
}

function isArtifactRecord(value: unknown): value is ProvenanceArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ProvenanceArtifact>;
  return (
    typeof record.path === "string" &&
    record.path.trim() !== "" &&
    typeof record.sha256 === "string" &&
    /^[0-9a-f]{64}$/i.test(record.sha256) &&
    Number.isSafeInteger(record.bytes) &&
    (record.bytes ?? -1) >= 0
  );
}

async function inspectArtifact(
  root: string,
  realRoot: string,
  manifestDir: string,
  artifact: ProvenanceArtifact,
): Promise<{ kind: "valid" | "mismatch" | "missing"; reason?: string }> {
  if (path.isAbsolute(artifact.path) || artifact.path.includes("..")) {
    return { kind: "mismatch", reason: `Artifact path rejected (absolute or path traversal): ${artifact.path}` };
  }
  const absPath = path.resolve(manifestDir, artifact.path);
  if (!isInside(root, absPath) && !isInside(manifestDir, absPath)) {
    return { kind: "mismatch", reason: `Artifact path escaped directory bounds: ${artifact.path}` };
  }
  try {
    const realPath = await fs.realpath(absPath);
    if (!isInside(realRoot, realPath)) {
      return {
        kind: "mismatch",
        reason: `Artifact ${artifact.path} symlink escapes the project and manifest directories.`,
      };
    }
    const hash = createHash("sha256");
    let streamedBytes = 0;
    for await (const chunk of createReadStream(realPath)) {
      hash.update(chunk);
      streamedBytes += chunk.byteLength;
    }
    const actualHash = hash.digest("hex");
    const fileStat = await fs.stat(realPath);
    if (actualHash !== artifact.sha256 || streamedBytes !== artifact.bytes || fileStat.size !== artifact.bytes) {
      return {
        kind: "mismatch",
        reason: `Artifact ${artifact.path} content modified after export (hash or byte-count mismatch).`,
      };
    }
    return { kind: "valid" };
  } catch {
    return { kind: "missing", reason: `Artifact ${artifact.path} missing or unreadable.` };
  }
}

type LoadedManifest =
  | { manifest: unknown; manifestDir: string; realRoot: string; manifestPath?: string }
  | { error: ProvenanceVerificationResult };

async function loadManifest(root: string, manifestOrPath: ExportProvenanceManifest | string): Promise<LoadedManifest> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return { error: { status: "missing", reasons: ["Project root is missing or unreadable."] } };
  }

  if (typeof manifestOrPath !== "string") {
    return { manifest: manifestOrPath, manifestDir: root, realRoot };
  }
  const absManifestPath = path.resolve(root, manifestOrPath);
  if (!isInside(root, absManifestPath)) {
    return {
      error: {
        status: "mismatch",
        reasons: [`Path traversal rejected for manifest path: ${manifestOrPath}`],
      },
    };
  }
  try {
    const realManifestPath = await fs.realpath(absManifestPath);
    if (!isInside(realRoot, realManifestPath)) {
      return {
        error: {
          status: "mismatch",
          reasons: ["Provenance manifest symlink escapes the project root."],
        },
      };
    }
    const raw = await readTextFile(absManifestPath);
    return {
      manifest: JSON.parse(raw),
      manifestDir: path.dirname(absManifestPath),
      realRoot,
      manifestPath: absManifestPath,
    };
  } catch (error) {
    return {
      error: {
        status: "missing",
        reasons: [
          `Provenance manifest unreadable or malformed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
    };
  }
}

function validateManifestStructure(manifest: unknown): ProvenanceVerificationResult | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { status: "unsupported", reasons: ["Invalid provenance manifest object."] };
  }
  const record = manifest as ExportProvenanceManifest;
  if (
    record.schemaVersion !== 1 ||
    record.tool?.name !== "boardreadyops" ||
    (record.kind !== undefined && record.kind !== "boardreadyops.export-provenance")
  ) {
    return {
      status: "unsupported",
      reasons: [`Unsupported or invalid provenance manifest schema version ${record.schemaVersion}`],
      manifest: record,
    };
  }
  if (record.sourceSnapshot !== undefined && record.sourceSnapshot !== "stable") {
    return {
      status: "mismatch",
      reasons: ["Provenance generator reports changed or invalid source input snapshot."],
      manifest: record,
    };
  }
  if (typeof record.sourceFingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(record.sourceFingerprint)) {
    return {
      status: "mismatch",
      reasons: ["Provenance manifest has no valid source SHA-256 fingerprint."],
      manifest: record,
    };
  }
  return undefined;
}

/**
 * Verifies a *self-reported* export inventory and current input file fingerprint.
 * A "verified" result here does not authenticate a generator, workflow, or reviewed
 * source commit. Strong source-bound provenance requires separate trusted attestation.
 */
export async function verifyExportProvenance(
  root: string,
  manifestOrPath: ExportProvenanceManifest | string,
  options: { currentGitSha?: string | undefined } = {},
): Promise<ProvenanceVerificationResult> {
  const loaded = await loadManifest(root, manifestOrPath);
  if ("error" in loaded) return loaded.error;
  const invalid = validateManifestStructure(loaded.manifest);
  if (invalid) return invalid;
  const manifest = loaded.manifest as ExportProvenanceManifest;
  const { manifestDir, realRoot } = loaded;

  const reasons: string[] = [];
  let currentFingerprint: string;
  let sourceCount: number;
  try {
    const current = await sourceFingerprintDetail(root);
    currentFingerprint = current.fingerprint;
    sourceCount = current.sourceCount;
  } catch {
    return {
      status: "mismatch",
      reasons: ["Source fingerprint could not be computed because a source input is unreadable or missing."],
      manifest,
    };
  }
  if (sourceCount === 0) {
    return {
      status: "mismatch",
      reasons: [NO_SOURCE_INPUTS_REASON],
      manifest,
    };
  }
  const sourceFingerprintMatch = currentFingerprint === manifest.sourceFingerprint;

  if (!sourceFingerprintMatch) {
    reasons.push(
      `Source fingerprint mismatch: current ${currentFingerprint.slice(0, 12)}… but manifest recorded ${manifest.sourceFingerprint.slice(0, 12)}…`,
    );
  }

  let gitShaMatch: boolean | undefined;
  if (options.currentGitSha) {
    const comparison = compareReviewedCommit(options.currentGitSha, manifest.git);
    gitShaMatch = comparison.match;
    if (comparison.reason) reasons.push(comparison.reason);
  }

  const artifactMismatches: string[] = [];
  const missingArtifacts: string[] = [];
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    reasons.push("Provenance manifest is missing a non-empty artifact inventory.");
  }
  const seenPaths = new Set<string>();
  for (const entry of Array.isArray(manifest.artifacts) ? manifest.artifacts : []) {
    if (!isArtifactRecord(entry)) {
      reasons.push("Provenance artifact entry has invalid path, SHA-256, or byte count.");
      continue;
    }
    const normalizedPath = path.posix.normalize(toPosixPath(entry.path));
    if (seenPaths.has(normalizedPath)) {
      artifactMismatches.push(entry.path);
      reasons.push(`Artifact path is duplicated in provenance manifest: ${entry.path}`);
      continue;
    }
    seenPaths.add(normalizedPath);

    const outcome = await inspectArtifact(root, realRoot, manifestDir, entry);
    if (outcome.reason) reasons.push(outcome.reason);
    if (outcome.kind === "mismatch") artifactMismatches.push(entry.path);
    if (outcome.kind === "missing") missingArtifacts.push(entry.path);
  }

  if (manifest.kind === "boardreadyops.export-provenance") {
    if (!loaded.manifestPath) {
      reasons.push("First-party output completeness requires an on-disk manifest.");
    } else {
      const validArtifacts = (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).filter(isArtifactRecord);
      reasons.push(...(await checkFirstPartyOutputSet(manifestDir, loaded.manifestPath, validArtifacts)));
    }
  }

  const status: ProvenanceVerificationResult["status"] = reasons.length === 0 ? "verified" : "mismatch";

  return {
    status,
    reasons,
    sourceFingerprintMatch,
    gitShaMatch,
    artifactMismatches,
    missingArtifacts,
    manifest,
  };
}
