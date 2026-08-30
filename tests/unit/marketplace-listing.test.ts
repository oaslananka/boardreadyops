import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Marketplace listing validation", () => {
  it("accepts the repository listing assets", () => {
    const result = runValidator(process.cwd());

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("keeps Marketplace App permissions aligned with target-repository execution", async () => {
    const guide = await fs.readFile(path.resolve("docs/github-marketplace.md"), "utf8");

    expect(guide).toContain("| **Actions** | Read & write |");
    expect(guide).not.toContain("| **Contents** | Read |");
    expect(guide).toContain("does not read repository contents through the GitHub REST API");
    expect(guide).toContain("target-repository GitHub Actions workflow");
  });

  it("rejects Marketplace badge links hidden inside another URL", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-marketplace-"));
    await fs.writeFile(
      path.join(root, "action.yml"),
      `name: BoardReadyOps
description: BoardReadyOps checks KiCad hardware repositories before fabrication.
branding:
  icon: shield
  color: green
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "README.md"),
      "[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-BoardReadyOps-blue)](https://example.test/https://github.com/marketplace/actions/boardreadyops)\n",
      "utf8",
    );

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must link the GitHub Marketplace badge");
  });

  it("rejects Marketplace descriptions longer than 125 characters", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-marketplace-"));
    await fs.writeFile(
      path.join(root, "action.yml"),
      `name: BoardReadyOps
description: This KiCad fabrication readiness action checks project files before board orders and explains manufacturing failures before production.
branding:
  icon: shield
  color: green
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "README.md"),
      "[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-BoardReadyOps-blue)](https://github.com/marketplace/actions/boardreadyops)\n",
      "utf8",
    );

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be between 50 and 125 characters");
  });

  it("accepts README links rooted at the repository", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-marketplace-"));
    await fs.mkdir(path.join(root, "docs"));
    await fs.writeFile(path.join(root, "docs/guide.md"), "# Guide\n", "utf8");
    await fs.writeFile(
      path.join(root, "action.yml"),
      `name: BoardReadyOps
description: BoardReadyOps checks KiCad hardware repositories before fabrication.
branding:
  icon: shield
  color: green
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "README.md"),
      `[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-BoardReadyOps-blue)](https://github.com/marketplace/actions/boardreadyops)
[Guide](/docs/guide.md)
`,
      "utf8",
    );

    const result = runValidator(root);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});

function runValidator(cwd: string) {
  return spawnSync(process.execPath, [path.resolve("scripts/check-marketplace-listing.mjs")], {
    cwd,
    encoding: "utf8",
  });
}
