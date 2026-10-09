import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { checkFirstPartyOutputSet } from "../core/generated-output-inventory.js";
import { isInside, resolveExistingPathAlias } from "../util/path.js";

type OutputKind = "evidence" | "handoff";

function isExpectedArtifact(
  value: unknown,
): value is { path?: string; target?: string; sha256: string; bytes: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.sha256 === "string" &&
    /^[a-f0-9]{64}$/iu.test(item.sha256) &&
    typeof item.bytes === "number" &&
    Number.isSafeInteger(item.bytes) &&
    item.bytes >= 0
  );
}

/** Refuse to recursively replace any directory that isn't an intact BoardReadyOps output. */
export async function assertSafeReleaseOutputCleanup(
  root: string,
  outputDirectory: string,
  kind: OutputKind,
): Promise<void> {
  const output = path.resolve(outputDirectory);
  const realRoot = await resolveExistingPathAlias(path.resolve(root));
  const realOutput = await resolveExistingPathAlias(output);
  if (
    isInside(realOutput, realRoot) ||
    output.split(path.sep).some((segment) => segment.toLowerCase() === ".git") ||
    realOutput.split(path.sep).some((segment) => segment.toLowerCase() === ".git")
  ) {
    throw new Error(
      "Release output overlaps a project, Git metadata, or a filesystem ancestor; choose a safe --output path.",
    );
  }

  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Release output must be a real directory, not a file or symlink.");
  }
  if ((await fs.readdir(output)).length === 0) return;

  const manifestName = kind === "evidence" ? "manifest.json" : "handoff-manifest.json";
  const manifestPath = path.join(output, manifestName);
  let record: Record<string, unknown>;
  try {
    const info = await fs.lstat(manifestPath);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("unsafe manifest");
    record = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("invalid manifest");
  } catch {
    throw new Error("Existing output is not a valid BoardReadyOps release package; choose a fresh --output path.");
  }
  const tool = record?.tool as Record<string, unknown> | undefined;
  const artifacts = record?.[kind === "evidence" ? "artifacts" : "files"];
  if (
    record.schemaVersion !== (kind === "evidence" ? 2 : 1) ||
    tool?.name !== "boardreadyops" ||
    !Array.isArray(artifacts) ||
    artifacts.length > 4096 ||
    !artifacts.every(isExpectedArtifact)
  ) {
    throw new Error("Existing release output has an unrecognized manifest; choose a fresh --output path.");
  }

  const fileEntries = (artifacts as Array<{ path?: string; target?: string; sha256: string; bytes: number }>).map(
    (artifact) => ({
      path: kind === "evidence" ? artifact.path : artifact.target,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    }),
  );
  if (fileEntries.some((entry) => typeof entry.path !== "string" || entry.path === "")) {
    throw new Error("Existing release output inventory is invalid; choose a fresh --output path.");
  }
  const extras = kind === "evidence" ? ["checksums.txt"] : ["README.md"];
  if (kind === "evidence") {
    // Signed evidence is immutable; never silently destroy an existing signature.
    try {
      await fs.lstat(path.join(output, "manifest.sig"));
      throw new Error("Signed release evidence is immutable; choose a fresh --output path.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const errors = await checkFirstPartyOutputSet(output, manifestPath, [
    ...fileEntries.map((entry) => ({ path: entry.path as string })),
    ...extras.map((name) => ({ path: name })),
  ]);
  if (errors.length) {
    throw new Error("Existing release output contains unsafe or undeclared files; choose a fresh --output path.");
  }
  for (const entry of fileEntries) {
    const filename = path.join(output, entry.path as string);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(filename)) {
      hash.update(chunk);
      bytes += chunk.byteLength;
    }
    if (bytes !== entry.bytes || hash.digest("hex") !== entry.sha256.toLowerCase()) {
      throw new Error("Existing release artifact has changed; choose a fresh --output path.");
    }
  }
}
