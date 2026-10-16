import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const repairSource = path.join(repoRoot, "scripts/repair-cloud-deploy-image-pin.sh");
const createdDirectories: string[] = [];
const describeOnLinux = process.platform === "linux" ? describe : describe.skip;
const shell = "$";

afterEach(() => {
  for (const dir of createdDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-image-pin-"));
  createdDirectories.push(root);
  const deployRoot = path.join(root, "deployment");
  fs.mkdirSync(deployRoot);
  const wrapper = path.join(deployRoot, "deploy.sh");
  const backup = path.join(deployRoot, "deploy.sh.pre-image-pin.bak");
  const original = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `repo_dir="${shell}{HOME}/repo"`,
    'fail() { printf "%s\\n" "$1" >&2; exit 78; }',
    "export BOARDREADYOPS_GIT_SHA",
    `BOARDREADYOPS_GIT_SHA="$(git -C "${shell}{repo_dir}" rev-parse HEAD)"`,
    `export BOARDREADYOPS_IMAGE_TAG="${shell}{BOARDREADYOPS_GIT_SHA}"`,
    "exec doppler run --project boardreadyops --config runtime -- true",
    "",
  ].join("\n");
  fs.writeFileSync(wrapper, original, { mode: 0o750 });
  const source = fs.readFileSync(repairSource, "utf8").replaceAll("/home/ubuntu/boardreadyops-cloud", deployRoot);
  const script = path.join(root, "repair.sh");
  fs.writeFileSync(script, source, { mode: 0o700 });
  const run = (mode: "--check" | "--apply" | "--rollback") =>
    spawnSync("bash", [script, mode], { encoding: "utf8", timeout: 10000 });
  return { root, deployRoot, wrapper, backup, original, run };
}

function evaluatePinnedTag(wrapper: string, given?: string) {
  const lines = fs.readFileSync(wrapper, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`if [[ -n "${shell}{BOARDREADYOPS_IMAGE_TAG:-}"`));
  const end = lines.indexOf(
    `export BOARDREADYOPS_IMAGE_TAG="${shell}{BOARDREADYOPS_IMAGE_TAG:-${shell}{BOARDREADYOPS_GIT_SHA}}"`,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const script = [
    "set -euo pipefail",
    "fail() { echo rejected >&2; exit 78; }",
    `BOARDREADYOPS_GIT_SHA="${"b".repeat(40)}"`,
    ...lines.slice(start, end + 1),
    `printf "%s" "${shell}{BOARDREADYOPS_IMAGE_TAG}"`,
  ].join("\n");
  const env = { ...process.env };
  delete env.BOARDREADYOPS_IMAGE_TAG;
  if (given !== undefined) env.BOARDREADYOPS_IMAGE_TAG = given;
  return spawnSync("bash", ["-c", script], { encoding: "utf8", env, timeout: 10000 });
}

describeOnLinux("host-local deploy wrapper image-tag contract", () => {
  it("checks without mutation and applies the exact patch with a restricted backup", () => {
    const f = fixture();
    const before = f.run("--check");
    expect(before.status).toBe(2);
    expect(fs.readFileSync(f.wrapper, "utf8")).toBe(f.original);
    expect(fs.existsSync(f.backup)).toBe(false);

    const changed = f.run("--apply");
    expect(changed.status, changed.stderr).toBe(0);
    expect(fs.readFileSync(f.backup, "utf8")).toBe(f.original);
    expect(fs.statSync(f.backup).mode & 0o777).toBe(0o600);
    expect(f.run("--check").status).toBe(0);
    expect(f.run("--apply").status).toBe(0);
    expect(fs.readFileSync(f.backup, "utf8")).toBe(f.original);
  });

  it("uses the checkout SHA normally and honors an explicitly pinned valid SHA", () => {
    const f = fixture();
    expect(f.run("--apply").status).toBe(0);
    const normal = evaluatePinnedTag(f.wrapper);
    const pinned = evaluatePinnedTag(f.wrapper, "a".repeat(40));
    expect(normal.status).toBe(0);
    expect(normal.stdout).toBe("b".repeat(40));
    expect(pinned.status).toBe(0);
    expect(pinned.stdout).toBe("a".repeat(40));
    const invalid = evaluatePinnedTag(f.wrapper, "not-a-git-sha");
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("rejected");
  });

  it("restores the original byte-for-byte, rejecting later edits", () => {
    const f = fixture();
    expect(f.run("--apply").status).toBe(0);
    fs.appendFileSync(f.wrapper, "\n# operator change\n");
    const stale = f.run("--rollback");
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("refuse to lose later edits");
    fs.writeFileSync(f.wrapper, fs.readFileSync(f.wrapper, "utf8").replace("\n# operator change\n", ""));
    const rollback = f.run("--rollback");
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(fs.readFileSync(f.wrapper, "utf8")).toBe(f.original);
    expect(fs.existsSync(f.backup)).toBe(true);
  });

  it("refuses to revoke image pinning after the policy mount has migrated", () => {
    const f = fixture();
    expect(f.run("--apply").status).toBe(0);
    fs.writeFileSync(
      path.join(f.deployRoot, "compose.release-policy.yml"),
      `${f.deployRoot}/release-repositories:/run/policies/repositories:ro\n`,
    );
    const refused = f.run("--rollback");
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("policy migration is active");
    expect(f.run("--check").status).toBe(0);
  });

  it("rejects symlinked wrappers and unknown tag assignments before changes", () => {
    const f = fixture();
    fs.appendFileSync(f.wrapper, 'export BOARDREADYOPS_IMAGE_TAG="latest"\n');
    expect(f.run("--apply").status).not.toBe(0);
    expect(fs.existsSync(f.backup)).toBe(false);
    fs.unlinkSync(f.wrapper);
    fs.symlinkSync(path.join(f.root, "repair.sh"), f.wrapper);
    expect(f.run("--apply").status).not.toBe(0);
    expect(fs.existsSync(f.backup)).toBe(false);
  });
});
