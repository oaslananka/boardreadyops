import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyExportProvenance } from "../core/provenance.js";
import type { GenerateResult } from "../release/generate.js";
import { createZipBuffer } from "../util/zip.js";

/**
 * Package real generated KiCad Gerber/Excellon outputs, after independently
 * rechecking the source fingerprint, pinned commit and every emitted file byte.
 *
 * This is a locally verified, **unsigned** archive. It is not a vendor approval,
 * signed release, attested runner result or permission to publish a guest link.
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
  const types = new Set(input.generated.artifacts.map((item) => item.kind));
  if (!types.has("gerber") || !types.has("drill")) {
    throw new Error("Manufacturing archive requires generated Gerber and Excellon drill files");
  }
  const attested = new Map(proof.manifest.artifacts.map((item) => [item.path, item]));
  if (attested.size !== input.generated.artifacts.length) {
    throw new Error("Manufacturing archive output inventory differs from verified proof");
  }
  const entries: Array<{ name: string; data: Buffer }> = [];
  let totalBytes = 0;
  for (const item of input.generated.artifacts) {
    const proofEntry = attested.get(item.path);
    if (!proofEntry || proofEntry.sha256 !== item.sha256 || proofEntry.bytes !== item.bytes) {
      throw new Error("Manufacturing archive source file was not in the verified export inventory");
    }
    const sourcePath = path.resolve(outputDir, item.path);
    const relative = path.relative(outputDir, sourcePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Manufacturing archive file escaped the verified output directory");
    }
    const handle = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error("Manufacturing output is not a regular file");
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > 32 * 1024 * 1024) throw new Error("Manufacturing archive exceeds the 32 MiB source limit");
    if (bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
      throw new Error("Manufacturing archive file changed after verification");
    }
    entries.push({ name: `outputs/${item.path.replaceAll(path.sep, "/")}`, data: bytes });
  }
  const manifest = await readFile(manifestPath);
  entries.push({ name: "export-provenance.json", data: manifest });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const archive = createZipBuffer(entries);
  if (archive.length > 64 * 1024 * 1024) throw new Error("Manufacturing ZIP exceeds the 64 MiB archive limit");
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
    files: input.generated.artifacts.length,
  };
}
