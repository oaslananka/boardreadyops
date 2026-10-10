import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { load } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";
import { detectKicadCli } from "../../src/kicad/cli.js";

const actionPath = path.resolve(".github/actions/manufacturing-attested-export");
const fixtureRoot = path.resolve("tests/fixtures/projects/safe-basic");
const ownedRoots: string[] = [];
const SHA_REGEX = /^[0-9a-f]{40}$/u;

interface ActionSpec {
  inputs: Record<string, { required: boolean }>;
  runs: { using: string; steps: Array<{ id: string; run: string }> };
}
interface TargetSpec {
  on: Record<string, unknown>;
  jobs: Record<string, { if: string; permissions: Record<string, string>; steps: Array<Record<string, unknown>> }>;
}

afterEach(async () => {
  for (const root of ownedRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function loadAction(): Promise<ActionSpec> {
  return load(await fs.readFile(path.join(actionPath, "action.yml"), "utf8")) as ActionSpec;
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-attested-export-"));
  ownedRoots.push(root);
  await fs.cp(fixtureRoot, root, { recursive: true });
  await fs.writeFile(path.join(root, ".gitignore"), "build/\n");
  // Only the reviewed source is part of this local test commit.
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"],
    { cwd: root },
  );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  expect(sha).toMatch(SHA_REGEX);
  const runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-temp-"));
  ownedRoots.push(runnerTemp);
  const output = path.join(runnerTemp, "runner-outputs.txt");
  await fs.writeFile(output, "");
  return { root, sha, output, runnerTemp };
}

async function runExport(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, string> = {}) {
  const action = await loadAction();
  const script = action.runs.steps[0]?.run;
  if (!script) throw new Error("Missing composite export shell");
  return spawnSync("bash", ["-e", "-c", script], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 150_000,
    env: {
      ...process.env,
      VITEST: undefined,
      GITHUB_WORKSPACE: f.root,
      GITHUB_SHA: f.sha,
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_OUTPUT: f.output,
      RUNNER_TEMP: f.runnerTemp,
      RUNNER_OS: "Linux",
      BOARDREADYOPS_ACTION_DIR: actionPath,
      BOARDREADYOPS_REVIEWED_SHA: f.sha,
      BOARDREADYOPS_PROJECT: "safe-basic.kicad_pro",
      BOARDREADYOPS_REF_PROTECTED: "true",
      BOARDREADYOPS_IS_FORK: "false",
      BOARDREADYOPS_RUNNER_ENVIRONMENT: "github-hosted",
      ...overrides,
    },
  });
}

describe("target-repository reviewed fabrication export signer boundary", () => {
  it("keeps attestation in the target job using pinned actions and least-privilege OIDC", async () => {
    const action = await loadAction();
    expect(action.runs.using).toBe("composite");
    expect(action.inputs["reviewed-source-sha"]?.required).toBe(true);
    expect(action.inputs.project?.required).toBe(true);
    const raw = await fs.readFile("examples/github/workflows/boardreadyops-manufacturing-attested.yml", "utf8");
    const target = load(raw) as TargetSpec;
    expect(Object.keys(target.on)).toEqual(["workflow_dispatch"]);
    const job = target.jobs["attest-manufacturing-export"];
    expect(job).toBeDefined();
    expect(job?.if).toBeUndefined(); // invalid refs must FAIL, not create a misleading skipped workflow
    expect(job?.permissions).toMatchObject({
      contents: "read",
      "id-token": "write",
      attestations: "write",
      "artifact-metadata": "write",
    });
    const steps = job?.steps ?? [];
    const exportIndex = steps.findIndex((step) => step.id === "export");
    const attestIndex = steps.findIndex((step) => step.id === "attestation");
    expect(exportIndex).toBeGreaterThan(0);
    expect(attestIndex).toBeGreaterThan(exportIndex);
    expect(steps[attestIndex]?.uses).toMatch(/^actions\/attest@[0-9a-f]{40}$/u);
    expect(steps[attestIndex]?.with).toEqual({
      "subject-checksums": "$" + "{{ steps.export.outputs.subject-checksums }}",
    });
    expect(steps[exportIndex]?.uses).toMatch(
      /^oaslananka\/boardreadyops\/\.github\/actions\/manufacturing-attested-export@[a-f0-9]{40}$/u,
    );
    expect(steps.some((step) => String(step.uses ?? "").startsWith("actions/upload-artifact@"))).toBe(true);
  });

  it("exports REAL KiCad Gerbers and drill from the exact clean SHA and inventories all bytes", async (ctx) => {
    const cli = await detectKicadCli();
    if (!process.env.CI) ctx.skip(!cli.found || !/^10\.0\./u.test(cli.version ?? ""), "Requires KiCad 10");
    expect(cli.found).toBe(true);
    expect(cli.version).toMatch(/^10\.0\./u);
    const f = await fixture();
    const result = await runExport(f);
    if (result.status !== 0)
      throw new Error(`Export shell exited ${result.status}: stdout=${result.stdout} stderr=${result.stderr}`);
    expect(result.status, result.stderr).toBe(0);
    const outputs = new Map(
      (await fs.readFile(f.output, "utf8"))
        .trim()
        .split("\n")
        .map((s) => s.split("=", 2) as [string, string]),
    );
    expect(outputs.get("manifest")).toBe("build/boardreadyops-attested/manifest.json");
    const checksumFile = outputs.get("subject-checksums");
    if (!checksumFile) throw new Error("Checksum output not emitted");
    const manifestPath = outputs.get("manifest");
    if (!manifestPath) throw new Error("Manifest output not emitted");
    const manifest = JSON.parse(await fs.readFile(path.join(f.root, manifestPath), "utf8")) as {
      git: { sha: string; dirty: boolean };
      steps: Array<{ kind: string; status: string }>;
      artifacts: Array<{ path: string; sha256: string; kind: string }>;
    };
    expect(manifest.git).toEqual({ sha: f.sha, dirty: false });
    expect(manifest.steps.filter((s) => s.status === "generated").map((s) => s.kind)).toEqual(["gerbers", "drill"]);
    expect(manifest.artifacts.some((a) => a.kind === "gerber")).toBe(true);
    expect(manifest.artifacts.some((a) => a.kind === "drill")).toBe(true);
    const checksumLines = (await fs.readFile(checksumFile, "utf8")).trim().split("\n");
    expect(checksumLines).toHaveLength(manifest.artifacts.length + 1);
    const subjects = new Set<string>();
    for (const line of checksumLines) {
      const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/u.exec(line);
      expect(match).not.toBeNull();
      if (!match) throw new Error("Invalid attestation subject checksum");
      const [, expected, name] = match;
      if (!expected || !name) throw new Error("Missing digest or subject name");
      expect(subjects.has(name)).toBe(false);
      subjects.add(name);
      const data = await fs.readFile(path.join(f.root, name));
      expect(createHash("sha256").update(data).digest("hex")).toBe(expected);
    }
    expect(subjects.has("build/boardreadyops-attested/manifest.json")).toBe(true);
    expect(subjects.has("build/boardreadyops-attested/gerbers/safe-basic-F_Cu.gtl")).toBe(true);
  });

  it.each([
    ["different SHA", { BOARDREADYOPS_REVIEWED_SHA: "f".repeat(40) }],
    ["unprotected branch", { BOARDREADYOPS_REF_PROTECTED: "false" }],
    ["untrusted runner", { BOARDREADYOPS_RUNNER_ENVIRONMENT: "self-hosted" }],
    ["pull request", { GITHUB_EVENT_NAME: "pull_request" }],
    ["PR merge ref", { GITHUB_REF: "refs/pull/99/merge" }],
    ["wrong project", { BOARDREADYOPS_PROJECT: "missing.kicad_pro" }],
  ])("fails closed before any export or checksums: %s", async (_name, overrides) => {
    const f = await fixture();
    expect((await runExport(f, overrides)).status).not.toBe(0);
    await expect(fs.stat(path.join(f.root, "build/boardreadyops-attested/manifest.json"))).rejects.toThrow();
  });

  it("rejects dirty checkout instead of signing modified KiCad inputs", async () => {
    const f = await fixture();
    await fs.appendFile(path.join(f.root, "safe-basic.kicad_pcb"), "\n");
    expect((await runExport(f)).status).not.toBe(0);
  });

  it("rejects unignored generated output to prevent silent source-tree drift", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, ".gitignore"), "other/\n");
    execFileSync("git", ["add", "-A"], { cwd: f.root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "changed ignore rule",
      ],
      { cwd: f.root },
    );
    f.sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
    expect((await runExport(f)).status).not.toBe(0);
  });
});
