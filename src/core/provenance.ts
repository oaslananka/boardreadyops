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

  if (manifest.schemaVersion !== 1 || manifest.tool?.name !== "boardreadyops") {
    return {
      status: "unsupported",
      reasons: [`Unsupported or invalid provenance manifest schema version ${manifest.schemaVersion}`],
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
  if (options.currentGitSha && manifest.git?.sha) {
    gitShaMatch = options.currentGitSha === manifest.git.sha;
    if (!gitShaMatch) {
      reasons.push(
        `Git SHA mismatch: current commit ${options.currentGitSha.slice(0, 12)}… but manifest recorded ${manifest.git.sha.slice(0, 12)}…`,
      );
    }
  }

  const artifactMismatches: string[] = [];
  const missingArtifacts: string[] = [];

  for (const artifact of manifest.artifacts ?? []) {
    if (path.isAbsolute(artifact.path) || artifact.path.includes("..")) {
      artifactMismatches.push(artifact.path);
      reasons.push(`Artifact path rejected (absolute or path traversal): ${artifact.path}`);
      continue;
    }

    const absPath = path.resolve(manifestDir, artifact.path);
    if (!isInside(root, absPath) && !isInside(manifestDir, absPath)) {
      artifactMismatches.push(artifact.path);
      reasons.push(`Artifact path escaped directory bounds: ${artifact.path}`);
      continue;
    }

    try {
      const content = await fs.readFile(absPath);
      const actualHash = createHash("sha256").update(content).digest("hex");
      if (actualHash !== artifact.sha256) {
        artifactMismatches.push(artifact.path);
        reasons.push(`Artifact ${artifact.path} content modified after export (hash mismatch).`);
      }
    } catch {
      missingArtifacts.push(artifact.path);
      reasons.push(`Artifact ${artifact.path} missing or unreadable.`);
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
