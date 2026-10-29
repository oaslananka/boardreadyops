import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_RESTORE_CONFIRMATION,
  verifyArtifactVolumeRestore,
} from "../../../scripts/verify-artifact-volume-restore.mjs";

let tempDir: string;
let sourceDir: string;
let restoredDir: string;
const proof = (maxFiles?: number, maxBytes?: number) =>
  verifyArtifactVolumeRestore({
    sourceDir,
    restoredDir,
    confirmation: ARTIFACT_RESTORE_CONFIRMATION,
    ...(maxFiles === undefined ? {} : { maxFiles }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "bro-artifact-restore-proof-"));
  sourceDir = path.join(tempDir, "snapshot");
  restoredDir = path.join(tempDir, "restored");
  await mkdir(sourceDir);
  await mkdir(restoredDir);
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("isolated nonempty artifact byte restore proof", () => {
  it("compares nested binary files and returns aggregate-only results", async () => {
    const data = randomBytes(1024);
    await mkdir(path.join(sourceDir, "run/artifacts"), { recursive: true });
    await mkdir(path.join(restoredDir, "run/artifacts"), { recursive: true });
    await writeFile(path.join(sourceDir, "run/artifacts/board.zip"), data);
    await writeFile(path.join(restoredDir, "run/artifacts/board.zip"), data);
    await writeFile(path.join(sourceDir, ".manifest"), "manifest");
    await writeFile(path.join(restoredDir, ".manifest"), "manifest");
    const result = await proof();
    expect(result).toEqual({ status: "verified", fileCount: 2, totalBytes: 1032 });
    expect(JSON.stringify(result)).not.toMatch(/board\.zip|run\/artifacts|sha256|manifest/);
  });

  it("accepts a canonicalized parent directory alias without accepting a symlink root", async () => {
    await writeFile(path.join(sourceDir, "artifact"), "bytes");
    await writeFile(path.join(restoredDir, "artifact"), "bytes");
    const alias = path.join(tempDir, "parent-alias");
    await symlink(tempDir, alias, "dir");
    await expect(
      verifyArtifactVolumeRestore({
        sourceDir: path.join(alias, "snapshot"),
        restoredDir: path.join(alias, "restored"),
        confirmation: ARTIFACT_RESTORE_CONFIRMATION,
      }),
    ).resolves.toEqual({ status: "verified", fileCount: 1, totalBytes: 5 });
  });

  it("refuses empty volumes", async () => {
    await expect(proof()).rejects.toThrow("empty_volume");
  });

  it("refuses tampered bytes even when the size is identical", async () => {
    await writeFile(path.join(sourceDir, "artifact"), "ABCD");
    await writeFile(path.join(restoredDir, "artifact"), "WXYZ");
    await expect(proof()).rejects.toThrow("integrity_mismatch");
  });

  it("refuses missing or extra file names", async () => {
    await writeFile(path.join(sourceDir, "artifact"), "data");
    await writeFile(path.join(restoredDir, "different"), "data");
    await expect(proof()).rejects.toThrow("integrity_mismatch");
  });

  it("rejects symlinked files and subdirectories", async () => {
    await writeFile(path.join(sourceDir, "artifact"), "data");
    await symlink(path.join(sourceDir, "artifact"), path.join(restoredDir, "artifact"));
    await expect(proof()).rejects.toThrow("unsafe_entry");
    await rm(path.join(restoredDir, "artifact"));
    await symlink(sourceDir, path.join(restoredDir, "linked-dir"));
    await expect(proof()).rejects.toThrow("unsafe_entry");
  });

  it("rejects identical, nested and symlinked roots", async () => {
    await expect(
      verifyArtifactVolumeRestore({ sourceDir, restoredDir: sourceDir, confirmation: ARTIFACT_RESTORE_CONFIRMATION }),
    ).rejects.toThrow("same_directory");
    const nested = path.join(sourceDir, "nested");
    await mkdir(nested);
    await expect(
      verifyArtifactVolumeRestore({ sourceDir, restoredDir: nested, confirmation: ARTIFACT_RESTORE_CONFIRMATION }),
    ).rejects.toThrow("nested_directory");
    await symlink(sourceDir, path.join(tempDir, "linked-root"));
    await expect(
      verifyArtifactVolumeRestore({
        sourceDir: path.join(tempDir, "linked-root"),
        restoredDir,
        confirmation: ARTIFACT_RESTORE_CONFIRMATION,
      }),
    ).rejects.toThrow("unsafe_entry");
  });

  it("enforces confirmation and size limits", async () => {
    await writeFile(path.join(sourceDir, "artifact"), "larger");
    await writeFile(path.join(restoredDir, "artifact"), "larger");
    await expect(proof(1, 5)).rejects.toThrow("budget_exceeded");
    await expect(verifyArtifactVolumeRestore({ sourceDir, restoredDir, confirmation: "unapproved" })).rejects.toThrow(
      "confirmation_required",
    );
  });

  it("never leaks paths or file names on a CLI error", () => {
    const script = fileURLToPath(new URL("../../../scripts/verify-artifact-volume-restore.mjs", import.meta.url));
    const run = spawnSync(
      process.execPath,
      [
        script,
        "--source-dir",
        sourceDir,
        "--restored-dir",
        restoredDir,
        "--confirmation",
        ARTIFACT_RESTORE_CONFIRMATION,
      ],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('{"status":"unknown","reason":"verification_failed"}\n');
    expect(run.stdout).not.toContain(tempDir);
    expect(run.stderr).not.toContain(tempDir);
  });
});
