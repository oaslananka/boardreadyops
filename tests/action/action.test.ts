import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = path.resolve("tests/fixtures/projects");

describe("action bundle", () => {
  it("runs against safe fixture and writes outputs", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-action-"));
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.cp(path.join(fixtureRoot, "safe-basic"), workspace, { recursive: true });
    const outputFile = path.join(workspace, "github-output.txt");
    const summaryFile = path.join(workspace, "github-summary.md");
    const actionBundle = path.resolve("dist/action/index.cjs");
    const result = spawnSync(process.execPath, [actionBundle], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        INPUT_PATH: ".",
        INPUT_CONFIG: "boardreadyops.yml",
        "INPUT_UPLOAD-SARIF": "false",
        "INPUT_UPLOAD-ARTIFACTS": "false",
        "INPUT_COMMENT-PR": "false",
        INPUT_ANNOTATIONS: "false",
        "INPUT_FAIL-ON": "high",
        INPUT_JSON: "boardreadyops.findings.json",
        INPUT_SARIF: "boardreadyops.sarif.json",
        INPUT_MARKDOWN: "boardreadyops.report.md",
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const output = await fs.readFile(outputFile, "utf8");
    expect(output).toContain("findings<<");
    expect(output).toMatch(/\r?\n0\r?\n/);
    expect(
      JSON.parse(await fs.readFile(path.join(workspace, "boardreadyops.findings.json"), "utf8")).summary.total,
    ).toBe(0);
  });

  it("reports the expected pinmap finding count through action outputs", async () => {
    const workspace = await workspaceFromFixture("pinmap-mismatch");
    const result = runActionBundle(workspace, {
      INPUT_PATH: ".",
      INPUT_CONFIG: "boardreadyops.yml",
      "INPUT_UPLOAD-SARIF": "false",
      "INPUT_UPLOAD-ARTIFACTS": "false",
      "INPUT_COMMENT-PR": "false",
      INPUT_ANNOTATIONS: "false",
      "INPUT_FAIL-ON": "never",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await outputValue(path.join(workspace, "github-output.txt"), "findings")).toBe("1");
  });

  it("writes HBOM output and reports the action output path", async () => {
    const workspace = await workspaceFromFixture("safe-basic");
    const result = runActionBundle(workspace, {
      INPUT_PATH: ".",
      INPUT_CONFIG: "boardreadyops.yml",
      INPUT_HBOM: "boardreadyops.hbom.json",
      "INPUT_UPLOAD-SARIF": "false",
      "INPUT_UPLOAD-ARTIFACTS": "false",
      "INPUT_COMMENT-PR": "false",
      INPUT_ANNOTATIONS: "false",
      "INPUT_FAIL-ON": "never",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await outputValue(path.join(workspace, "github-output.txt"), "hbom-path")).toBe(
      path.join(workspace, "boardreadyops.hbom.json"),
    );
    const hbom = JSON.parse(await fs.readFile(path.join(workspace, "boardreadyops.hbom.json"), "utf8"));
    expect(hbom).toMatchObject({
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      components: [{ name: "RC0603FR-0710KL" }],
    });
  });

  it("skips trusted-write operations for fork pull requests", async () => {
    const workspace = await workspaceFromFixture("safe-basic");
    const eventPath = path.join(workspace, "event.json");
    await fs.writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 7,
          base: { repo: { full_name: "oaslananka/boardreadyops" } },
          head: { repo: { full_name: "someone/boardreadyops" } },
        },
      }),
      "utf8",
    );
    const result = runActionBundle(workspace, {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: "oaslananka/boardreadyops",
      GITHUB_REF: "refs/pull/7/merge",
      GITHUB_SHA: "0123456789012345678901234567890123456789",
      GITHUB_TOKEN: "dummy-token",
      INPUT_PATH: ".",
      INPUT_CONFIG: "boardreadyops.yml",
      "INPUT_UPLOAD-SARIF": "true",
      "INPUT_UPLOAD-ARTIFACTS": "false",
      "INPUT_COMMENT-PR": "true",
      INPUT_ANNOTATIONS: "false",
      "INPUT_FAIL-ON": "never",
      INPUT_SARIF: "boardreadyops.sarif.json",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await fs.stat(path.join(workspace, "boardreadyops.sarif.json"))).toBeTruthy();
  });

  it("suppresses trusted write operations in safe mode even when requested", async () => {
    const workspace = await workspaceFromFixture("safe-basic");
    const result = runActionBundle(workspace, {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "oaslananka/private-hardware",
      GITHUB_REF: "refs/heads/feature",
      GITHUB_SHA: "0123456789012345678901234567890123456789",
      GITHUB_TOKEN: "must-not-be-used",
      INPUT_PATH: ".",
      INPUT_CONFIG: "boardreadyops.yml",
      "INPUT_SAFE-MODE": "true",
      "INPUT_UPLOAD-SARIF": "true",
      "INPUT_UPLOAD-ARTIFACTS": "true",
      "INPUT_COMMENT-PR": "true",
      INPUT_ANNOTATIONS: "false",
      "INPUT_FAIL-ON": "never",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("fails the action when findings meet the configured threshold", async () => {
    const workspace = await workspaceFromFixture("bom-missing-mpn");
    const result = runActionBundle(workspace, {
      INPUT_PATH: ".",
      INPUT_CONFIG: "boardreadyops.yml",
      "INPUT_UPLOAD-SARIF": "false",
      "INPUT_UPLOAD-ARTIFACTS": "false",
      "INPUT_COMMENT-PR": "false",
      INPUT_ANNOTATIONS: "false",
      "INPUT_FAIL-ON": "high",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("BoardReadyOps found");
  });

  it("writes candidate-mismatch hardware impact without changing the current run conclusion", async () => {
    const workspace = await workspaceFromFixture("safe-basic");
    initializeGitWorkspace(workspace);
    const eventPath = path.join(workspace, "event.json");
    await fs.writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 9,
          base: { sha: "a".repeat(40), repo: { full_name: "oaslananka/boardreadyops" } },
          head: { sha: "b".repeat(40), repo: { full_name: "oaslananka/boardreadyops" } },
        },
      }),
      "utf8",
    );

    const execution = runActionBundle(workspace, {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: "oaslananka/boardreadyops",
      GITHUB_RUN_ID: "900",
      GITHUB_TOKEN: "dummy-token",
      INPUT_PATH: ".",
      INPUT_CONFIG: "boardreadyops.yml",
      "INPUT_UPLOAD-SARIF": "false",
      "INPUT_UPLOAD-ARTIFACTS": "false",
      "INPUT_COMMENT-PR": "false",
      INPUT_ANNOTATIONS: "false",
      "INPUT_FAIL-ON": "never",
    });

    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0);
    const json = JSON.parse(await fs.readFile(path.join(workspace, "boardreadyops.findings.json"), "utf8"));
    expect(json.hardwareImpact).toMatchObject({
      baseline: { status: "unavailable", sha: "a".repeat(40), reason: "candidate-mismatch" },
      candidate: { sha: "b".repeat(40) },
      assessment: { materialChange: false, riskDirection: "unknown", affectedDomains: [] },
    });
    expect(json.summary.failed).toBe(false);
  });
});

async function workspaceFromFixture(fixture: string): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-action-"));
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.cp(path.join(fixtureRoot, fixture), workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "github-output.txt"), "", "utf8");
  await fs.writeFile(path.join(workspace, "github-summary.md"), "", "utf8");
  return workspace;
}

function runActionBundle(workspace: string, env: Record<string, string>) {
  const actionBundle = path.resolve("dist/action/index.cjs");
  return spawnSync(process.execPath, [actionBundle], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: path.join(workspace, "github-output.txt"),
      GITHUB_STEP_SUMMARY: path.join(workspace, "github-summary.md"),
      INPUT_JSON: "boardreadyops.findings.json",
      INPUT_SARIF: "boardreadyops.sarif.json",
      INPUT_MARKDOWN: "boardreadyops.report.md",
      ...env,
    },
  });
}

function initializeGitWorkspace(workspace: string): void {
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "tests@boardreadyops.dev"],
    ["config", "user.name", "BoardReadyOps Tests"],
    ["add", "."],
    ["commit", "--quiet", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  }
}

async function outputValue(file: string, name: string): Promise<string | undefined> {
  const text = await fs.readFile(file, "utf8");
  const heredoc = new RegExp(`${name}<<([^\\r\\n]+)\\r?\\n([\\s\\S]*?)\\r?\\n\\1`);
  const heredocMatch = heredoc.exec(text);
  if (heredocMatch) {
    return heredocMatch[2]?.trim();
  }
  return new RegExp(`${name}=([^\\r\\n]+)`).exec(text)?.[1];
}
