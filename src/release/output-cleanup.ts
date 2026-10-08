import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { checkFirstPartyOutputSet } from "../core/generated-output-inventory.js";
import { isInside, resolveExistingPathAlias } from "../util/path.js";

type ProtectedGenerationInputs = {
  gitRoot?: string | undefined;
  boardFile?: string | undefined;
  schematicFile?: string | undefined;
};

type PreviousArtifact = { path: string; sha256: string; bytes: number };

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_ARTIFACTS = 4096;
const hashPattern = /^[0-9a-f]{64}$/iu;

function isNoEntry(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isPreviousArtifact(value: unknown): value is PreviousArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<PreviousArtifact>;
  return (
    typeof item.path === "string" &&
    item.path.length > 0 &&
    typeof item.sha256 === "string" &&
    hashPattern.test(item.sha256) &&
    Number.isSafeInteger(item.bytes) &&
    (item.bytes ?? -1) >= 0
  );
}

async function readManagedOutputManifest(directory: string): Promise<PreviousArtifact[]> {
  const filename = path.join(directory, "manifest.json");
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(filename);
  } catch {
    throw new Error("Output directory is not an identifiable BoardReadyOps generation; choose a fresh --output path.");
  }
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error("Existing generation manifest is missing, unsafe or too large; choose a fresh --output path.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch {
    throw new Error("Existing generation manifest cannot be parsed; choose a fresh --output path.");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Output directory has no recognizable generated inventory; choose a fresh --output path.");
  }
  const record = manifest as Record<string, unknown>;
  const tool = record.tool;
  const recognized =
    record.schemaVersion === 1 &&
    (record.kind === undefined || record.kind === "boardreadyops.export-provenance") &&
    tool !== null &&
    typeof tool === "object" &&
    !Array.isArray(tool) &&
    (tool as Record<string, unknown>).name === "boardreadyops";
  if (!recognized || !Array.isArray(record.artifacts) || record.artifacts.length > MAX_MANIFEST_ARTIFACTS) {
    throw new Error("Output directory has no recognizable generated inventory; choose a fresh --output path.");
  }
  if (!record.artifacts.every(isPreviousArtifact)) {
    throw new Error("Existing generation inventory is malformed; choose a fresh --output path.");
  }
  return record.artifacts;
}

async function verifyExistingArtifactBytes(directory: string, artifacts: readonly PreviousArtifact[]): Promise<void> {
  for (const artifact of artifacts) {
    const filename = path.join(directory, artifact.path);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(filename)) {
      hash.update(chunk);
      bytes += chunk.byteLength;
    }
    if (bytes !== artifact.bytes || hash.digest("hex").toLowerCase() !== artifact.sha256.toLowerCase()) {
      throw new Error("A previously generated artifact has changed; choose a fresh --output path.");
    }
  }
}

async function assertPreviouslyGeneratedOutput(directory: string): Promise<void> {
  const artifacts = await readManagedOutputManifest(directory);
  const errors = await checkFirstPartyOutputSet(directory, path.join(directory, "manifest.json"), artifacts);
  if (errors.length > 0) {
    throw new Error(
      "Existing output contains undeclared, missing or unsafe generated files; choose a fresh --output path.",
    );
  }
  await verifyExistingArtifactBytes(directory, artifacts);
}

/** Guard all user-selected recursive output cleanup before any mutation. */
export async function assertSafeGenerateOutputCleanup(
  outputDirectory: string,
  inputs: ProtectedGenerationInputs,
): Promise<void> {
  const output = path.resolve(outputDirectory);
  const canonicalOutput = await resolveExistingPathAlias(output);
  if (canonicalOutput === path.parse(canonicalOutput).root) {
    throw new Error("Refusing to delete a filesystem root as a generated output directory.");
  }
  if (
    output.split(path.sep).some((segment) => segment.toLowerCase() === ".git") ||
    canonicalOutput.split(path.sep).some((segment) => segment.toLowerCase() === ".git")
  ) {
    throw new Error("Refusing to delete repository Git metadata as generated output.");
  }
  for (const input of [inputs.gitRoot, inputs.boardFile, inputs.schematicFile]) {
    if (!input) continue;
    const canonicalInput = await resolveExistingPathAlias(path.resolve(input));
    if (isInside(canonicalOutput, canonicalInput)) {
      throw new Error("Generated output directory overlaps the project or source input; choose a safe --output path.");
    }
  }
  if (inputs.gitRoot) {
    const gitMetadata = path.join(await resolveExistingPathAlias(inputs.gitRoot), ".git");
    if (isInside(gitMetadata, canonicalOutput)) {
      throw new Error("Refusing to delete repository Git metadata as generated output.");
    }
  }

  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(output);
  } catch (error) {
    if (isNoEntry(error)) return;
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new Error("Generated output must be a real directory, not a file or symlink.");
  }
  const entries = await fs.readdir(output);
  if (entries.length === 0) return;
  await assertPreviouslyGeneratedOutput(output);
}
