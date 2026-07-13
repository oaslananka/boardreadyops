import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-clean-tree-"));
  roots.push(root);
  runGit(root, ["init", "--quiet"]);
  const hooksPath = path.join(root, ".git", "test-hooks");
  await mkdir(hooksPath, { recursive: true });
  runGit(root, ["config", "core.hooksPath", hooksPath]);
  runGit(root, ["config", "commit.gpgSign", "false"]);
  runGit(root, ["config", "user.email", "tests@example.com"]);
  runGit(root, ["config", "user.name", "BoardReadyOps Tests"]);

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
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "--quiet", "-m", "test fixture"]);
  return root;
}

async function writeTracked(root: string, relativePath: string, content: string) {
  await writeFileRecursive(path.join(root, relativePath), content);
  runGit(root, ["add", relativePath]);
  runGit(root, ["commit", "--quiet", "-m", `update ${relativePath}`]);
}

async function writeFileRecursive(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function runVerifier(root: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: isolatedGitEnvironment(),
  });
}

function runGit(root: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: isolatedGitEnvironment() });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function isolatedGitEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  return env;
}
