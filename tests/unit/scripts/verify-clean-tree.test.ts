import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isolatedGitEnvironment } from "../../helpers/git-environment.js";

const scriptPath = path.join(process.cwd(), "scripts", "verify-clean-tree.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verify-clean-tree", () => {
  it("accepts ignored dependencies, public owner guards, mirror terminology, and generated NOTICE text", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, "node_modules", "example"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "example", "index.js"), "export {};\n");

    const result = runVerifier(root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects tracked generated artifact directories", async () => {
    const root = await createRepository();
    await writeTracked(root, "coverage/report.json", "{}\n");

    const result = runVerifier(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("generated artifact is tracked: coverage");
  });

  it("ignores hostile global Git configuration", async () => {
    const environment = await createHostileGitEnvironment();
    for (const scope of ["--global", "--system"]) {
      const config = spawnSync("git", ["config", scope, "--list"], { encoding: "utf8", env: environment });
      expect(config.status).toBe(0);
      expect(config.stdout).toBe("");
    }

    const root = await createRepository(environment);
    await writeTracked(root, "coverage/report.json", "{}\n", environment);

    const result = runVerifier(root, environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("generated artifact is tracked: coverage");
  });

  it("continues to reject banned language in project-authored files", async () => {
    const root = await createRepository();
    const phrase = [`${"sta"}${"te"}`, `${"o"}${"f"}`, `${"t"}${"he"}`, `${"a"}${"rt"}`].join("-");
    await writeTracked(root, "README.md", `A ${phrase} release tool.\n`);

    const result = runVerifier(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("banned language in README.md");
  });

  it("continues to reject internal laboratory identifiers", async () => {
    const root = await createRepository();
    const identifier = `oaslananka-${"la"}${"b"}`;
    await writeTracked(root, "README.md", `Internal owner: ${identifier}\n`);

    const result = runVerifier(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("forbidden content in README.md");
  });
});

async function createRepository(environment = isolatedGitEnvironment()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-clean-tree-"));
  roots.push(root);
  runGit(root, ["init", "--quiet"], environment);
  const hooksPath = path.join(root, ".git", "test-hooks");
  await mkdir(hooksPath, { recursive: true });
  runGit(root, ["config", "core.hooksPath", hooksPath], environment);
  runGit(root, ["config", "commit.gpgSign", "false"], environment);
  runGit(root, ["config", "user.email", "tests@example.com"], environment);
  runGit(root, ["config", "user.name", "BoardReadyOps Tests"], environment);

  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await writeFile(
    path.join(root, "NOTICE"),
    `Third-party description: ${[`${"sta"}${"te"}`, `${"o"}${"f"}`, `${"t"}${"he"}`, `${"a"}${"rt"}`].join("-")} utilities for writing ${"produc"}${"tion"}-grade software.\n`,
  );
  await writeFile(path.join(root, "README.md"), "A public repository mirror is documented here.\n");
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFileRecursive(path.join(root, "dist", "action", "index.cjs"), "module.exports = {};\n");
  await writeFileRecursive(path.join(root, "dist", "cli", "index.cjs"), "module.exports = {};\n");
  await writeFileRecursive(
    path.join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  test:\n    if: github.repository_owner == 'oaslananka' || github.repository_owner == 'oaslananka-ops'\n    runs-on: ubuntu-24.04\n",
  );
  runGit(root, ["add", "."], environment);
  runGit(root, ["commit", "--quiet", "-m", "test fixture"], environment);
  return root;
}

async function writeTracked(
  root: string,
  relativePath: string,
  content: string,
  environment = isolatedGitEnvironment(),
) {
  await writeFileRecursive(path.join(root, relativePath), content);
  runGit(root, ["add", relativePath], environment);
  runGit(root, ["commit", "--quiet", "-m", `update ${relativePath}`], environment);
}

async function writeFileRecursive(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function runVerifier(root: string, environment = isolatedGitEnvironment()) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
}

function runGit(root: string, args: string[], environment = isolatedGitEnvironment()) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: environment });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

async function createHostileGitEnvironment() {
  const home = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-hostile-git-"));
  roots.push(home);
  const excludesFile = path.join(home, "global-ignore");
  const hooksPath = path.join(home, "global-hooks");
  await mkdir(hooksPath, { recursive: true });
  await writeFile(excludesFile, "coverage/\n");
  await writeFile(
    path.join(home, ".gitconfig"),
    `[core]\n  excludesFile = ${gitConfigPath(excludesFile)}\n  hooksPath = ${gitConfigPath(hooksPath)}\n[commit]\n  gpgSign = true\n[alias]\n  environment = config --list\n`,
  );
  return isolatedGitEnvironment({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config") });
}

function gitConfigPath(value: string) {
  return value.replaceAll("\\", "/");
}
