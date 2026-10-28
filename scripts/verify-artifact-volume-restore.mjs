#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ARTIFACT_RESTORE_CONFIRMATION = "isolated-restored-artifacts";
const DEFAULT_MAX_FILES = 10_000;
const DEFAULT_MAX_BYTES = 1_073_741_824;

function nested(a, b) {
  const relative = path.relative(a, b);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function rootDirectory(input) {
  if (typeof input !== "string" || !path.isAbsolute(input) || path.normalize(input) !== input)
    throw Error("invalid_root");
  const state = await lstat(input);
  if (!state.isDirectory() || state.isSymbolicLink()) throw Error("unsafe_entry");
  const resolved = await realpath(input);
  // /var -> /private/var on macOS and normalized drive paths on Windows
  // can change an ancestor without making the root itself a symlink.
  // lstat above rejects symlinked roots; use canonical paths for traversal.
  return { resolved, state };
}

async function digest(file, expected) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size ||
      before.mtimeMs !== expected.mtimeMs
    )
      throw Error("changed_during_scan");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw Error("changed_during_scan");
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function inventory(root, limits) {
  const files = new Map();
  let totalBytes = 0;
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRel = rel ? path.join(rel, entry.name) : entry.name;
      const next = path.join(dir, entry.name);
      const state = await lstat(next);
      if (state.isSymbolicLink()) throw Error("unsafe_entry");
      if (state.isDirectory()) {
        if ((await realpath(next)) !== next) throw Error("unsafe_entry");
        await walk(next, nextRel);
      } else if (state.isFile()) {
        if (files.size >= limits.maxFiles || totalBytes + state.size > limits.maxBytes) throw Error("budget_exceeded");
        totalBytes += state.size;
        files.set(nextRel, { bytes: state.size, sha: await digest(next, state) });
      } else throw Error("unsafe_entry");
    }
  }
  await walk(root, "");
  return { files, totalBytes };
}

/** Compare stable isolated copies; no writes, backup creation, DB access or sensitive output. */
export async function verifyArtifactVolumeRestore({
  sourceDir,
  restoredDir,
  confirmation,
  maxFiles = DEFAULT_MAX_FILES,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  if (confirmation !== ARTIFACT_RESTORE_CONFIRMATION) throw Error("confirmation_required");
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw Error("invalid_budget");
  }
  const source = await rootDirectory(sourceDir);
  const restored = await rootDirectory(restoredDir);
  if (source.state.dev === restored.state.dev && source.state.ino === restored.state.ino) throw Error("same_directory");
  if (nested(source.resolved, restored.resolved) || nested(restored.resolved, source.resolved))
    throw Error("nested_directory");
  const original = await inventory(source.resolved, { maxFiles, maxBytes });
  const recovered = await inventory(restored.resolved, { maxFiles, maxBytes });
  if (!original.files.size || !recovered.files.size) throw Error("empty_volume");
  if (original.totalBytes !== recovered.totalBytes || original.files.size !== recovered.files.size) {
    throw Error("integrity_mismatch");
  }
  for (const [name, proof] of original.files) {
    const other = recovered.files.get(name);
    if (!other || other.bytes !== proof.bytes || other.sha !== proof.sha) throw Error("integrity_mismatch");
  }
  return { status: "verified", fileCount: original.files.size, totalBytes: original.totalBytes };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--source-dir" || args[2] !== "--restored-dir" || args[4] !== "--confirmation") {
    process.stdout.write(`${JSON.stringify({ status: "unknown", reason: "invalid_arguments" })}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await verifyArtifactVolumeRestore({
      sourceDir: args[1],
      restoredDir: args[3],
      confirmation: args[5],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ status: "unknown", reason: "verification_failed" })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
