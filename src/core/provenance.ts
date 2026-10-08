import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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

// Exact-file-set checking is limited to first-party generated output directories.
// Matching self-reported bytes does NOT authenticate the reviewed Git commit or exporter.
const MAX_FIRST_PARTY_OUTPUT_ENTRIES = 4096;
const MAX_FIRST_PARTY_OUTPUT_DEPTH = 32;

function canonicalGeneratedPath(value: string): boolean {
  if (!value || value.includes("\\") || path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (path.posix.normalize(value) !== value) return false;
  return value.split("/").every(
    (part) =>
      part !== "" &&
      part !== "." &&
      part !== ".." &&
      !/[<>:"|?*\u0000-\u001f]/u.test(part) &&
      !/[. ]$/u.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part),
  );
}

async function checkFirstPartyOutputSet(
  directory: string,
  manifestPath: string,
  artifacts: ProvenanceArtifact[],
): Promise<string[]> {
  const reasons: string[] = [];
  const declaredFiles = new Set<string>();
  const declaredAliases = new Set<string>();
  const expectedDirectories = new Set<string>();

  for (const artifact of artifacts) {
    const name = artifact.path;
    if (!canonicalGeneratedPath(name) || name === path.basename(manifestPath)) {
      reasons.push("Non-canonical generated artifact path or manifest self-reference: " + name);
      continue;
    }
    const portableKey = name.normalize("NFC").toLowerCase();
    if (declaredAliases.has(portableKey)) {
      reasons.push("Cross-platform generated artifact alias: " + name);
      continue;
    }
    declaredAliases.add(portableKey);
    declaredFiles.add(name);
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index++) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }

  const actualFiles = new Set<string>();
  const actualAliases = new Set<string>();
  const pending: Array<{ dir: string; relative: string; depth: number }> = [
    { dir: directory, relative: "", depth: 0 },
  ];
  let entriesVisited = 0;

  try {
    const actualRoot = await fs.realpath(directory);
    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) break;
      const iterator = await fs.opendir(current.dir);
      for await (const entry of iterator) {
        entriesVisited++;
        if (entriesVisited > MAX_FIRST_PARTY_OUTPUT_ENTRIES) {
          throw new Error("Output tree scan exceeds " + MAX_FIRST_PARTY_OUTPUT_ENTRIES + " entries.");
        }
        const relative = current.relative ? current.relative + "/" + entry.name : entry.name;
        const absolute = path.join(current.dir, entry.name);
        const metadata = await fs.lstat(absolute);
        if (metadata.isSymbolicLink()) {
          reasons.push("Symlink in generated output: " + relative);
        } else if (metadata.isDirectory()) {
          if (!expectedDirectories.has(relative)) {
            reasons.push("Undeclared generated directory: " + relative);
          }
          if (current.depth >= MAX_FIRST_PARTY_OUTPUT_DEPTH) {
            throw new Error("Output tree scan exceeds depth " + MAX_FIRST_PARTY_OUTPUT_DEPTH + ".");
          }
          const realDirectory = await fs.realpath(absolute);
          if (realDirectory !== path.resolve(actualRoot, relative)) {
            throw new Error("Generated directory has a noncanonical real path: " + relative);
          }
          pending.push({ dir: absolute, relative, depth: current.depth + 1 });
        } else if (!metadata.isFile()) {
          reasons.push("Non-file entry in generated output: " + relative);
        } else if (absolute !== manifestPath) {
          if (!canonicalGeneratedPath(relative)) {
            reasons.push("Non-canonical generated output filename: " + relative);
          }
          const portableKey = relative.normalize("NFC").toLowerCase();
          if (actualAliases.has(portableKey)) {
            reasons.push("Cross-platform generated output filename alias: " + relative);
          }
          actualAliases.add(portableKey);
          actualFiles.add(relative);
        }
      }
    }
  } catch (error) {
    reasons.push(
      "Generated output enumeration failed closed: " + (error instanceof Error ? error.message : String(error)),
    );
  }
  for (const file of [...actualFiles].sort()) {
    if (!declaredFiles.has(file)) reasons.push("Undeclared generated artifact: " + file);
  }
  for (const file of [...declaredFiles].sort()) {
    if (!actualFiles.has(file)) reasons.push("Declared generated artifact missing from file set: " + file);
  }
  return reasons;
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
    return { manifest: JSON.parse(raw), manifestDir: path.dirname(absManifestPath), realRoot, manifestPath: absManifestPath };
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
