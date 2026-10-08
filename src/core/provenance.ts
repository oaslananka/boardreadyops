import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { boardReadyVersion } from "../generated/version.js";
import { readTextFile } from "../util/fs.js";
import { globFiles } from "../util/glob.js";
import { isInside, normalizeRelative, toPosixPath } from "../util/path.js";

interface ProvenanceArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ExportProvenanceManifest {
  schemaVersion: 1;
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  git?: { sha?: string | undefined; dirty?: boolean | undefined } | undefined;
  sourceFingerprint: string;
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

const SOURCE_PATTERNS = [
  "**/*.kicad_pcb",
  "**/*.kicad_sch",
  "**/*.kicad_pro",
  "**/*.kicad_jobset",
  "**/*.kicad_dru",
  "**/*.kicad_wks",
];

export async function computeSourceFingerprint(
  root: string,
  customPatterns: string[] = SOURCE_PATTERNS,
): Promise<string> {
  const files = await globFiles(root, customPatterns);
  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));

  const hasher = createHash("sha256");
  for (const absolutePath of sortedFiles) {
    const relPath = normalizeRelative(root, absolutePath);
    const content = await fs.readFile(absolutePath).catch(() => Buffer.alloc(0));
    hasher.update(`${relPath}\0`, "utf8");
    hasher.update(content);
    hasher.update("\0", "utf8");
  }

  return hasher.digest("hex");
}

export async function createExportProvenanceManifest(options: {
  root: string;
  artifacts: Array<{ path: string; sha256: string; bytes: number }>;
  git?: { sha?: string | undefined; dirty?: boolean | undefined } | undefined;
  generatedAt?: string | undefined;
}): Promise<ExportProvenanceManifest> {
  const sourceFingerprint = await computeSourceFingerprint(options.root);
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
    if (!isInside(root, realPath) && !isInside(manifestDir, realPath)) {
      return {
        kind: "mismatch",
        reason: `Artifact ${artifact.path} symlink escapes the project and manifest directories.`,
      };
    }
    const content = await fs.readFile(realPath);
    const actualHash = createHash("sha256").update(content).digest("hex");
    if (actualHash !== artifact.sha256 || content.byteLength !== artifact.bytes) {
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
  let manifest: ExportProvenanceManifest;
  let manifestDir = root;

  if (typeof manifestOrPath === "string") {
    const absManifestPath = path.resolve(root, manifestOrPath);
    if (!isInside(root, absManifestPath)) {
      return {
        status: "mismatch",
        reasons: [`Path traversal rejected for manifest path: ${manifestOrPath}`],
      };
    }
    manifestDir = path.dirname(absManifestPath);
    try {
      const realManifestPath = await fs.realpath(absManifestPath);
      if (!isInside(root, realManifestPath)) {
        return {
          status: "mismatch",
          reasons: ["Provenance manifest symlink escapes the project root."],
        };
      }
      const raw = await readTextFile(absManifestPath);
      manifest = JSON.parse(raw) as ExportProvenanceManifest;
    } catch (error) {
      return {
        status: "missing",
        reasons: [
          `Provenance manifest unreadable or malformed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  } else {
    manifest = manifestOrPath;
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { status: "unsupported", reasons: ["Invalid provenance manifest object."] };
  }

  if (manifest.schemaVersion !== 1 || manifest.tool?.name !== "boardreadyops") {
    return {
      status: "unsupported",
      reasons: [`Unsupported or invalid provenance manifest schema version ${manifest.schemaVersion}`],
      manifest,
    };
  }

  if (typeof manifest.sourceFingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.sourceFingerprint)) {
    return {
      status: "mismatch",
      reasons: ["Provenance manifest has no valid source SHA-256 fingerprint."],
      manifest,
    };
  }

  const reasons: string[] = [];
  const currentFingerprint = await computeSourceFingerprint(root);
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

    const outcome = await inspectArtifact(root, manifestDir, entry);
    if (outcome.reason) reasons.push(outcome.reason);
    if (outcome.kind === "mismatch") artifactMismatches.push(entry.path);
    if (outcome.kind === "missing") missingArtifacts.push(entry.path);
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
