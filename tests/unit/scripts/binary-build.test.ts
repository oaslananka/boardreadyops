import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BINARY_TARGETS, binaryTargetIds, selectBinaryTargets } from "../../../scripts/build-binary.mjs";
import { expectedBinaryAssets, prepareBinaryReleaseAssets } from "../../../scripts/prepare-binary-release-assets.mjs";
import { currentBinaryTargetId, verificationCommands } from "../../../scripts/verify-binaries.mjs";

function readProjectFile(filePath: string) {
  return readFileSync(path.resolve(filePath), "utf8");
}

describe("binary build scripts", () => {
  it("builds every supported target by default", () => {
    expect(binaryTargetIds(selectBinaryTargets([]))).toEqual([
      "linux-x64",
      "linux-arm64",
      "macos-x64",
      "macos-arm64",
      "windows-x64",
    ]);
  });

  it("selects one named target for platform matrix jobs", () => {
    expect(binaryTargetIds(selectBinaryTargets(["--target", "windows-x64"]))).toEqual(["windows-x64"]);
    expect(binaryTargetIds(selectBinaryTargets(["--", "--target", "linux-arm64"]))).toEqual(["linux-arm64"]);
    expect(() => selectBinaryTargets(["--target", "freebsd-x64"])).toThrow("Unsupported binary target");
  });

  it("uses the current Bun Windows x64 compile target", () => {
    expect(BINARY_TARGETS.find((target) => target.id === "windows-x64")?.bunTarget).toBe("bun-windows-x64");
  });

  it("maps runtime hosts to their matching binary target", () => {
    expect(currentBinaryTargetId("linux", "x64")).toBe("linux-x64");
    expect(currentBinaryTargetId("linux", "arm64")).toBe("linux-arm64");
    expect(currentBinaryTargetId("darwin", "x64")).toBe("macos-x64");
    expect(currentBinaryTargetId("darwin", "arm64")).toBe("macos-arm64");
    expect(currentBinaryTargetId("win32", "x64")).toBe("windows-x64");
  });

  it("smoke tests help, version, and doctor for a binary artifact", () => {
    expect(verificationCommands("dist/binary/boardreadyops-linux-x64")).toEqual([
      ["dist/binary/boardreadyops-linux-x64", "--help"],
      ["dist/binary/boardreadyops-linux-x64", "--version"],
      ["dist/binary/boardreadyops-linux-x64", "doctor"],
    ]);
  });

  it("publishes the exact binary artifacts that passed the smoke matrix", () => {
    const workflow = readProjectFile(".github/workflows/binary-build.yml");
    const releaseAssetsJob = workflow.slice(workflow.indexOf("  release-assets:"));
    const matrixArtifactName = "name: boardreadyops-$" + "{{ matrix.target }}";

    expect(workflow).toContain("release-tag:");
    expect(workflow).toContain(matrixArtifactName);
    expect(workflow).toContain("path: dist/binary/boardreadyops-*");
    expect(workflow.match(/retention-days: 1/gu) ?? []).toHaveLength(2);
    expect(releaseAssetsJob).toContain("actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c");
    expect(releaseAssetsJob).toContain("pattern: boardreadyops-*");
    expect(releaseAssetsJob).toContain("merge-multiple: true");
    expect(releaseAssetsJob).not.toContain("pnpm run build:binary -- --target");
    expect(releaseAssetsJob).toContain("pnpm run build:binary:assets");
    expect(releaseAssetsJob).toContain("Verify release asset publication");
    expect(releaseAssetsJob).toContain("pnpm run build:binary:publish");
    expect(releaseAssetsJob).not.toContain("gh release upload");
    expect(releaseAssetsJob).not.toContain("gh release create");
    expect(releaseAssetsJob).not.toContain("softprops/action-gh-release");
  });

  it("publishes release assets with bounded concurrency, idempotent clobber, and bounded retry", async () => {
    const root = await makeBinaryAssetFixture();
    await writeFile(path.join(root, "SHA256SUMS"), "checksums");
    await writeFile(path.join(root, "sbom.cyclonedx.json"), "sbom");

    try {
      const { publishBinaryReleaseAssets } = await import("../../../scripts/publish-binary-release-assets.mjs");
      const calls: string[][] = [];
      const attempts = new Map<string, number>();
      let active = 0;
      let maximumActive = 0;

      const result = await publishBinaryReleaseAssets({
        root,
        releaseTag: "v1.27.0",
        concurrency: 3,
        maxAttempts: 3,
        sleep: async () => undefined,
        runGh: async (args: string[]) => {
          calls.push(args);
          if (args[1] === "view") throw new Error("release not found");
          if (args[1] === "create") return;
          const asset = path.basename(args[3] ?? "");
          const attempt = (attempts.get(asset) ?? 0) + 1;
          attempts.set(asset, attempt);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          if (asset === "boardreadyops-linux-x64" && attempt === 1) {
            throw new Error("transient upload failure");
          }
        },
      });

      expect(calls.filter((args) => args[1] === "create")).toHaveLength(1);
      expect(calls.filter((args) => args[1] === "upload")).toHaveLength(8);
      expect(calls.filter((args) => args[1] === "upload").every((args) => args.includes("--clobber"))).toBe(true);
      expect(maximumActive).toBeGreaterThan(1);
      expect(maximumActive).toBeLessThanOrEqual(3);
      expect(attempts.get("boardreadyops-linux-x64")).toBe(2);
      expect(result).toEqual({ uploaded: 7, attempts: 8, maximumConcurrency: 3 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers when a transient release lookup races with an already-existing release", async () => {
    const root = await makeBinaryAssetFixture();
    await writeFile(path.join(root, "SHA256SUMS"), "checksums");
    await writeFile(path.join(root, "sbom.cyclonedx.json"), "sbom");

    try {
      const { publishBinaryReleaseAssets } = await import("../../../scripts/publish-binary-release-assets.mjs");
      let views = 0;
      let creates = 0;
      let uploads = 0;

      await expect(
        publishBinaryReleaseAssets({
          root,
          releaseTag: "v1.27.0",
          concurrency: 2,
          maxAttempts: 2,
          sleep: async () => undefined,
          runGh: async (args: string[]) => {
            if (args[1] === "view") {
              views += 1;
              if (views === 1) throw new Error("transient release lookup failure");
              return;
            }
            if (args[1] === "create") {
              creates += 1;
              throw new Error("release already exists");
            }
            if (args[1] === "upload") uploads += 1;
          },
        }),
      ).resolves.toMatchObject({ uploaded: 7 });
      expect(views).toBe(2);
      expect(creates).toBe(1);
      expect(uploads).toBe(7);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails after the configured upload attempt limit", async () => {
    const root = await makeBinaryAssetFixture();
    await writeFile(path.join(root, "SHA256SUMS"), "checksums");
    await writeFile(path.join(root, "sbom.cyclonedx.json"), "sbom");

    try {
      const { publishBinaryReleaseAssets } = await import("../../../scripts/publish-binary-release-assets.mjs");
      let uploadAttempts = 0;
      await expect(
        publishBinaryReleaseAssets({
          root,
          releaseTag: "v1.27.0",
          concurrency: 1,
          maxAttempts: 2,
          sleep: async () => undefined,
          runGh: async (args: string[]) => {
            if (args[1] === "view") return;
            if (args[1] === "upload") {
              uploadAttempts += 1;
              throw new Error("persistent upload failure");
            }
          },
        }),
      ).rejects.toThrow("failed to upload boardreadyops-linux-x64 after 2 attempts");
      expect(uploadAttempts).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates checksums for every expected release asset", async () => {
    const root = await makeBinaryAssetFixture();
    try {
      const result = await prepareBinaryReleaseAssets(root);
      const checksums = await readFile(path.join(root, "SHA256SUMS"), "utf8");

      expect(result.assets).toEqual([
        "boardreadyops-linux-x64",
        "boardreadyops-linux-arm64",
        "boardreadyops-macos-x64",
        "boardreadyops-macos-arm64",
        "boardreadyops-win-x64.exe",
      ]);
      for (const asset of result.assets) {
        const expectedHash = createHash("sha256").update(`payload:${asset}`).digest("hex");
        expect(checksums).toContain(`${expectedHash}  ${asset}\n`);
      }
      await expect(prepareBinaryReleaseAssets(root, { check: true })).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a binary release asset is missing or checksums are stale", async () => {
    const root = await makeBinaryAssetFixture({ skip: "boardreadyops-linux-arm64" });
    try {
      await expect(prepareBinaryReleaseAssets(root)).rejects.toThrow(
        "Missing non-empty binary release asset: boardreadyops-linux-arm64",
      );

      await writeFile(path.join(root, "dist/binary/boardreadyops-linux-arm64"), "payload:boardreadyops-linux-arm64");
      await prepareBinaryReleaseAssets(root);
      await writeFile(path.join(root, "dist/binary/boardreadyops-linux-x64"), "changed");

      await expect(prepareBinaryReleaseAssets(root, { check: true })).rejects.toThrow(
        "SHA256SUMS is stale for binary release assets",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps Homebrew formula binary assets checksum-verified", () => {
    const formula = readProjectFile("Formula/boardreadyops.rb");

    expect(formula).not.toContain(":no_check");
    expect(formula.match(/sha256 "[0-9a-f]{64}"/g)).toHaveLength(4);
  });

  it("keeps the PowerShell installer compatible with existing and current sessions", () => {
    const installer = readProjectFile("install.ps1");

    expect(installer).toContain("function Invoke-BoardReadyOpsDownload");
    expect(installer).toContain("$parameters.UseBasicParsing = $true");
    expect(installer).toContain('$env:Path = if ($env:Path) { "$env:Path;$InstallDir" } else { $InstallDir }');
  });
});

async function makeBinaryAssetFixture(options: { skip?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-binary-assets-"));
  const binaryDir = path.join(root, "dist/binary");
  await mkdir(binaryDir, { recursive: true });

  for (const asset of expectedBinaryAssets()) {
    if (asset !== options.skip) {
      await writeFile(path.join(binaryDir, asset), `payload:${asset}`);
    }
  }

  return root;
}
