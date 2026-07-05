import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { preReleaseSteps, requiredPackageFiles, verifyPackageContents } from "../../../scripts/verify-pre-release.mjs";

describe("verify-pre-release", () => {
  it("runs the release gate in a predictable order", () => {
    expect(preReleaseSteps.map((step) => `${step.command} ${step.args.join(" ")}`)).toEqual([
      "pnpm run lint",
      "pnpm run typecheck",
      "pnpm run build",
      "pnpm run verify:dist",
      "pnpm run verify:version",
      "pnpm run verify:marketplace",
      "pnpm run test:unit",
      "pnpm run test:property",
      "pnpm run test:snapshot",
      "pnpm run test:action",
      "pnpm run test:a11y",
      "pnpm run coverage",
      "pnpm run docs",
      "pnpm run security",
    ]);
  });

  it("requires release-critical package files", () => {
    expect(requiredPackageFiles).toEqual([
      "package.json",
      "README.md",
      "LICENSE",
      "NOTICE",
      "SECURITY.md",
      "action.yml",
      "dist/cli/index.cjs",
      "dist/action/index.cjs",
    ]);
  });

  it("rejects package contents that omit the committed dist bundles", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-pack-missing-dist-"));
    await mkdir(path.join(root, "dist/cli"), { recursive: true });
    await mkdir(path.join(root, "dist/action"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "boardreadyops-test", version: "0.0.0", files: ["dist/cli/index.cjs"] }),
    );
    await writeFile(path.join(root, "README.md"), "# Test\n");
    await writeFile(path.join(root, "LICENSE"), "test\n");
    await writeFile(path.join(root, "NOTICE"), "test\n");
    await writeFile(path.join(root, "SECURITY.md"), "# Security\n");
    await writeFile(path.join(root, "action.yml"), "name: Test\n");
    await writeFile(path.join(root, "dist/cli/index.cjs"), "console.log('cli')\n");

    await expect(verifyPackageContents(root, { writeSummary: false })).rejects.toThrow("dist/action/index.cjs");
  });
});
