import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ExportProvenanceManifest, verifyExportProvenance } from "../core/provenance.js";
import { createZipBuffer } from "../util/zip.js";
import type { GenerateResult } from "./generate.js";

type Output = GenerateResult["artifacts"][number];
type Entry = { name: string; data: Buffer };

const maxSourceBytes = 32 * 1024 * 1024;
const maxArchiveBytes = 64 * 1024 * 1024;

async function readMatchingManifest(manifestPath: string, verified: ExportProvenanceManifest): Promise<Buffer> {
  const data = await readFile(manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error("Manufacturing export manifest changed after verification");
  }
  if (JSON.stringify(parsed) !== JSON.stringify(verified)) {
    throw new Error("Manufacturing export manifest changed after verification");
  }
  return data;
}

async function readVerifiedOutput(outputDir: string, item: Output): Promise<Entry> {
  const sourcePath = path.resolve(outputDir, item.path);
  const relative = path.relative(outputDir, sourcePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) {
    throw new Error("Manufacturing archive file escaped the verified output directory");
  }
  const handle = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxSourceBytes) {
      throw new Error("Manufacturing output is not a bounded regular file");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
    throw new Error("Manufacturing archive file changed after verification");
  }
  return { name: `outputs/${item.path.replaceAll(path.sep, "/")}`, data: bytes };
}

/**
 * Package *real* KiCad export bytes with their locally verified provenance.
 * The ZIP is unsigned. This does not attest a workflow identity, approve a
 * fabricator, or authorize customer cloud delivery.
 */
export async function createVerifiedManufacturingZip(input: {
  root: string;
  generated: GenerateResult;
  sourceCommitSha: string;
  destination: string;
}): Promise<{ path: string; sha256: string; bytes: number; files: number }> {
  if (!/^[0-9a-f]{40}$/u.test(input.sourceCommitSha)) {
    throw new Error("Manufacturing archive requires a pinned Git commit");
  }
  const root = path.resolve(input.root);
  const manifestPath = path.resolve(input.generated.manifestPath);
  const outputDir = path.resolve(input.generated.outputDir);
  const manifestRelative = path.relative(root, manifestPath);
  if (manifestRelative.startsWith("..") || path.isAbsolute(manifestRelative)) {
    throw new Error("Export manifest must be inside the checkout");
  }
  const proof = await verifyExportProvenance(root, manifestRelative, { currentGitSha: input.sourceCommitSha });
  if (proof.status !== "verified" || !proof.manifest || proof.gitShaMatch !== true) {
    throw new Error("Manufacturing export proof does not match its source or output bytes");
  }
  if (input.generated.failures !== 0 || input.generated.artifacts.length === 0) {
    throw new Error("Manufacturing archive requires a successful real KiCad export");
  }
  const generated = input.generated.artifacts;
  const types = new Set(generated.map((item) => item.kind));
  if (!types.has("gerber") || !types.has("drill")) {
    throw new Error("Manufacturing archive requires generated Gerber and Excellon drill files");
  }
  const attested = new Map(proof.manifest.artifacts.map((item) => [item.path, item]));
  const paths = new Set(generated.map((item) => item.path));
  if (paths.size !== generated.length || attested.size !== generated.length || generated.length > 256) {
    throw new Error("Manufacturing archive output inventory differs from verified proof");
  }
  if (generated.reduce((total, item) => total + item.bytes, 0) > maxSourceBytes) {
    throw new Error("Manufacturing archive exceeds the 32 MiB source limit");
  }
  for (const item of generated) {
    const expected = attested.get(item.path);
    if (expected?.sha256 !== item.sha256 || expected?.bytes !== item.bytes) {
      throw new Error("Manufacturing archive source file was not in the verified export inventory");
    }
  }
  const entries = await Promise.all(generated.map((item) => readVerifiedOutput(outputDir, item)));
  const manifest = await readMatchingManifest(manifestPath, proof.manifest);
  entries.push({ name: "export-provenance.json", data: manifest });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const archive = createZipBuffer(entries);
  if (archive.length > maxArchiveBytes) throw new Error("Manufacturing ZIP exceeds the 64 MiB archive limit");
  const destination = path.resolve(input.destination);
  if (destination === manifestPath || destination.startsWith(outputDir + path.sep)) {
    throw new Error("Manufacturing ZIP destination must be outside the verified output inventory");
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, archive, { flag: "wx", mode: 0o600 });
  return {
    path: destination,
    sha256: createHash("sha256").update(archive).digest("hex"),
    bytes: archive.length,
    files: generated.length,
  };
}
