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

function runnerTempInBash(value: string): string {
  if (process.platform !== "win32") return value;
  return value
    .replace(/^([A-Za-z]):[\\/]/u, (_match, drive: string) => `/${drive.toLowerCase()}/`)
    .replace(/\\/gu, "/");
}

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

  it("connects optional source-bound manufacturing export to the exact readiness run without changing normal runner permissions", async () => {
    const raw = await fs.readFile(".github/workflows/readiness-runner.yml", "utf8");
    const workflow = load(raw) as TargetSpec;
    const job = workflow.jobs.readiness;
    expect(job?.permissions).toMatchObject({
      actions: "read",
      checks: "read",
      contents: "read",
      "id-token": "write",
    });
    expect(job?.permissions).not.toHaveProperty("attestations");
    expect(job?.permissions).not.toHaveProperty("artifact-metadata");
    const steps = job?.steps ?? [];
    const exportIndex = steps.findIndex((step) => step.id === "manufacturing-export");
    const signIndex = steps.findIndex((step) => step.id === "manufacturing-attestation");
    const importIndex = steps.findIndex((step) => step.id === "manufacturing-export-import");
    const resultIndex = steps.findIndex((step) =>
      String(step.name ?? "").startsWith("Publish OIDC-authenticated cloud result"),
    );
    expect(exportIndex).toBeGreaterThan(-1);
    expect(signIndex).toBeGreaterThan(exportIndex);
    expect(importIndex).toBeGreaterThan(signIndex);
    expect(resultIndex).toBeGreaterThan(importIndex);
    expect(steps[exportIndex]?.if).toContain("vars.BOARDREADYOPS_PROJECT");
    expect(steps[exportIndex]?.uses).toBe(
      "oaslananka/boardreadyops/.github/actions/manufacturing-attested-export@bbdfd58631d5c8daca1179a10f74b45533903b58",
    );
    expect(steps[exportIndex]?.with).toMatchObject({
      "reviewed-source-sha": "$" + "{{ inputs.head_sha }}",
      project: "$" + "{{ vars.BOARDREADYOPS_PROJECT }}",
    });
    expect(String(steps[signIndex]?.run)).toContain("attestProvenance");
    expect(String(steps[signIndex]?.run)).toContain("skipWrite: true");
    expect(String((steps[importIndex]?.with as { script?: string } | undefined)?.script)).toContain(
      "core.getIDToken(audience)",
    );
    expect(String((steps[importIndex]?.with as { script?: string } | undefined)?.script)).toContain(
      "/manufacturing-export",
    );
    const importerScript = String((steps[importIndex]?.with as { script?: string } | undefined)?.script);
    expect(importerScript).toContain("boardreadyops-manufacturing-export:");
    expect(importerScript).not.toContain("boardreadyops-cloud:");
    for (const index of [exportIndex, signIndex, importIndex]) {
      expect(steps[index]?.["continue-on-error"]).toBe(true);
    }
  });

  it("keeps real GitHub OIDC signing confined to a manually dispatched protected test fixture", async () => {
    const raw = await fs.readFile(".github/workflows/attested-fixture-validation.yml", "utf8");
    const wf = load(raw) as TargetSpec;
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    const job = wf.jobs["attest-fixture"];
    expect(job?.permissions).toMatchObject({
      contents: "read",
      "id-token": "write",
    });
    const steps = job?.steps ?? [];
    const guard = steps.find((step) => String(step.name ?? "").startsWith("Require protected main"));
    expect(guard?.run).toContain("refs/heads/main");
    expect(raw).toContain("PROTECTED_REF:");
    expect(guard?.run).toContain("PROTECTED_REF");
    const exportStep = steps.find((step) => step.id === "export");
    expect(exportStep?.uses).toBe("./.github/actions/manufacturing-attested-export");
    expect((exportStep?.with as { project?: string } | undefined)?.project).toBe(
      "tests/fixtures/projects/safe-basic/safe-basic.kicad_pro",
    );
    expect(steps.some((step) => String(step.uses ?? "").startsWith("actions/attest@"))).toBe(false);
    const install = steps.find((step) =>
      String(step.name ?? "").startsWith("Install pinned GitHub attestation library"),
    );
    expect(install?.run).toContain("@actions/attest@3.2.0");
    const sign = steps.find((step) => String(step.id ?? "") === "internal");
    expect(sign?.run).toContain("sigstore:'github'");
    expect(sign?.run).toContain("skipWrite:true");
    expect(sign?.run).toContain("rfc3161Timestamps");
    expect(steps.filter((step) => String(step.uses ?? "").startsWith("actions/upload-artifact@"))).toHaveLength(2);
    expect(steps.some((step) => JSON.stringify(step).includes("test-fixture-sigstore-bundle"))).toBe(true);
    expect(raw).not.toContain("attestations: write");
    expect(raw).not.toContain("artifact-metadata: write");
    expect(raw).toContain("TEST FIXTURE ONLY");
    expect(raw).not.toContain("pull_request:");
  });

  it("provides an isolated GitHub-internal signed bundle path without API or public transparency-log storage", async () => {
    const raw = await fs.readFile("examples/github/workflows/boardreadyops-manufacturing-internal.yml", "utf8");
    const template = load(raw) as TargetSpec;
    expect(Object.keys(template.on)).toEqual(["workflow_dispatch"]);
    const job = template.jobs["attest-manufacturing-export"];
    expect(job).toBeDefined();
    expect(job?.if).toBeUndefined();
    expect(job?.permissions).toEqual({ contents: "read", "id-token": "write" });
    const steps = job?.steps ?? [];
    const exportIndex = steps.findIndex((step) => step.id === "export");
    const signIndex = steps.findIndex((step) => step.id === "internal");
    expect(exportIndex).toBeGreaterThan(0);
    expect(signIndex).toBeGreaterThan(exportIndex);
    expect(steps[exportIndex]?.uses).toMatch(
      /^oaslananka\/boardreadyops\/\.github\/actions\/manufacturing-attested-export@[a-f0-9]{40}$/u,
    );
    const sign = String(steps[signIndex]?.run ?? "");
    expect(sign).toContain("github.ref_protected");
    expect(sign).toContain("github.event.repository.fork");
    expect(sign).toContain("git status --porcelain");
    expect(sign).toContain("attestProvenance");
    expect(sign).toContain("sigstore:'github'");
    expect(sign).toContain("skipWrite:true");
    expect(sign).toContain("result.attestationID||result.tlogID");
    expect(sign).toContain("verificationMaterial?.tlogEntries");
    expect(sign).toContain("rfc3161Timestamps");
    expect(sign).toContain("Unsafe subject checksum list");
    expect(raw).toContain("@actions/attest@3.2.0");
    expect(raw).toContain("--ignore-scripts");
    expect(steps.some((step) => /^actions\/attest@/u.test(String(step.uses ?? "")))).toBe(false);
    expect(steps.filter((step) => String(step.uses ?? "").startsWith("actions/upload-artifact@"))).toHaveLength(2);
    expect(raw).toContain("reviewed-manufacturing-internal-attestation");
    expect(raw).toContain("reviewed-manufacturing-export");
    expect(raw).not.toContain("attestations: write");
    expect(raw).not.toContain("artifact-metadata: write");
  });

  it("restores the clean reviewed checkout before optional manufacturing signing without losing its readiness report", async () => {
    const raw = await fs.readFile(".github/workflows/readiness-runner.yml", "utf8");
    const workflow = load(raw) as TargetSpec;
    const steps = workflow.jobs.readiness?.steps ?? [];
    const readinessIndex = steps.findIndex((step) => step.id === "readiness");
    const stageIndex = steps.findIndex((step) => step.id === "stage-readiness-reports");
    const exportIndex = steps.findIndex((step) => step.id === "manufacturing-export");
    const publishIndex = steps.findIndex((step) => String(step.name).startsWith("Publish OIDC-authenticated"));
    expect(readinessIndex).toBeGreaterThan(-1);
    expect(stageIndex).toBeGreaterThan(readinessIndex);
    expect(exportIndex).toBeGreaterThan(stageIndex);
    expect(publishIndex).toBeGreaterThan(exportIndex);
    expect(String(steps[stageIndex]?.if)).toContain("steps.readiness.outcome != 'skipped'");
    expect(String(steps[exportIndex]?.if)).toContain("steps.stage-readiness-reports.outcome == 'success'");
    expect(String((steps[publishIndex]?.with as { script?: string } | undefined)?.script)).toContain(
      "const reportPath = `$" + "{process.env.RUNNER_TEMP}/boardreadyops.findings.json`;",
    );
    const stagingScript = String(steps[stageIndex]?.run);
    expect(stagingScript).toContain("git ls-files --error-unmatch");
    expect(stagingScript).toContain("mv --");
    // The signed export still verifies the actual checkout, not a staged report or an ignored source tree.
    const exporter = await loadAction();
    expect(exporter.runs.steps[0]?.run).toContain("git status --porcelain=v1 --untracked-files=all");
    const f = await fixture();
    const reports = {
      "boardreadyops.findings.json": '{"schemaVersion":1,"findings":[]}',
      "boardreadyops.sarif.json": '{"version":"2.1.0"}',
      "boardreadyops.report.md": "# Readiness report\n",
    };
    for (const [name, value] of Object.entries(reports)) await fs.writeFile(path.join(f.root, name), value);
    expect(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: f.root, encoding: "utf8" }),
    ).toContain("boardreadyops.findings.json");
    const staged = spawnSync("bash", ["-e", "-c", stagingScript], {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, RUNNER_TEMP: runnerTempInBash(f.runnerTemp) },
    });
    expect(staged.status, staged.stderr).toBe(0);
    for (const [name, value] of Object.entries(reports)) {
      await expect(fs.readFile(path.join(f.root, name), "utf8")).rejects.toThrow();
      expect(await fs.readFile(path.join(f.runnerTemp, name), "utf8")).toBe(value);
    }
    expect(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: f.root, encoding: "utf8" }).trim(),
    ).toBe("");
    // A separate untracked or modified source file is never hidden by the report staging.
    await fs.writeFile(path.join(f.root, "unrelated.kicad_pcb"), "unreviewed source");
    expect(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: f.root, encoding: "utf8" }),
    ).toContain("unrelated.kicad_pcb");
  });

  it("refuses to move a tracked readiness output from the reviewed source", async () => {
    const raw = await fs.readFile(".github/workflows/readiness-runner.yml", "utf8");
    const workflow = load(raw) as TargetSpec;
    const stage = workflow.jobs.readiness?.steps.find((step) => step.id === "stage-readiness-reports");
    expect(stage).toBeDefined();
    const f = await fixture();
    const filename = "boardreadyops.findings.json";
    await fs.writeFile(path.join(f.root, filename), '{"schemaVersion":1}');
    execFileSync("git", ["add", "--", filename], { cwd: f.root });
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
        "track report",
      ],
      { cwd: f.root },
    );
    const refused = spawnSync("bash", ["-e", "-c", String(stage?.run)], {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, RUNNER_TEMP: runnerTempInBash(f.runnerTemp) },
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toContain("must be an untracked regular file");
    expect(await fs.readFile(path.join(f.root, filename), "utf8")).toContain("schemaVersion");
    await expect(fs.readFile(path.join(f.runnerTemp, filename))).rejects.toThrow();
  });
  it("exports REAL KiCad Gerbers, drill, BOM and CPL from the exact clean SHA and inventories all bytes", async (ctx) => {
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
    expect(manifest.steps.filter((s) => s.status === "generated").map((s) => s.kind)).toEqual([
      "gerbers",
      "drill",
      "bom",
      "positions",
    ]);
    for (const kind of ["gerber", "drill", "bom", "cpl"]) {
      expect(manifest.artifacts.some((artifact) => artifact.kind === kind && artifact.sha256.length === 64)).toBe(true);
    }
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
    expect(subjects.has("build/boardreadyops-attested/assembly/bom.csv")).toBe(true);
    expect(subjects.has("build/boardreadyops-attested/assembly/positions.csv")).toBe(true);
  });

  it("binds generated bytes to the checked-out reviewed source SHA even when the signer workflow SHA differs", async () => {
    const f = await fixture();
    const signerWorkflowSha = "b".repeat(40);
    const result = await runExport(f, { GITHUB_SHA: signerWorkflowSha });
    expect(result.status, result.stderr).toBe(0);
    const outputs = new Map(
      (await fs.readFile(f.output, "utf8"))
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2) as [string, string]),
    );
    const manifest = JSON.parse(await fs.readFile(path.join(f.root, outputs.get("manifest") ?? ""), "utf8")) as {
      git?: { sha?: string };
    };
    expect(manifest.git?.sha).toBe(f.sha);
    expect(manifest.git?.sha).not.toBe(signerWorkflowSha);
  });

  it("refuses an archive when the reviewed source has no BOM schematic", async () => {
    const f = await fixture();
    await fs.rm(path.join(f.root, "safe-basic.kicad_sch"));
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
        "remove schematic",
      ],
      { cwd: f.root },
    );
    f.sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
    const result = await runExport(f);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Incomplete manufacturing export");
    expect(await fs.readFile(f.output, "utf8")).not.toContain("subject-checksums=");
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
