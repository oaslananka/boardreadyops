import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const versionChecker = resolve("scripts/verify-version.mjs");

type VersionCheckOptions = {
  source?: string;
  prepared?: string;
  manifest?: string;
};

function runVersionCheck({ source = "1.69.0", prepared = source, manifest = source }: VersionCheckOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "boardreadyops-prepared-release-"));
  try {
    mkdirSync(join(dir, "src", "generated"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: source }));
    writeFileSync(join(dir, ".release-please-manifest.json"), JSON.stringify({ ".": manifest }));
    writeFileSync(
      join(dir, "src/generated/version.ts"),
      `export const boardReadyVersion = ${JSON.stringify(source)};\n`,
    );
    writeFileSync(
      join(dir, "README.md"),
      `**Repository-prepared version:** \`boardreadyops@${prepared}\`. Not necessarily published.\n`,
    );
    return spawnSync(process.execPath, [versionChecker], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("source package version without public release assumptions", () => {
  it("accepts a prepared candidate even before npm or GitHub publication", () => {
    const result = runVersionCheck();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects an incorrect or missing prepared source version", () => {
    const mismatch = runVersionCheck({ prepared: "1.68.3" });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain("README source package version mismatch");

    const missing = runVersionCheck({ prepared: "" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("found missing");
  });

  it("continues to reject mismatched release manifest versions", () => {
    const result = runVersionCheck({ manifest: "1.68.3" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("version mismatch");
  });
});
