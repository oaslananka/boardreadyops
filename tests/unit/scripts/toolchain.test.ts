import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBootstrapPlan,
  evaluateToolchain,
  resolveToolchainPaths,
  type ToolchainManifest,
  type ToolchainProbe,
} from "../../../scripts/toolchain.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

async function repositoryFile(file: string): Promise<string> {
  return readFile(path.join(root, file), "utf8");
}

async function manifest(): Promise<ToolchainManifest> {
  return JSON.parse(await repositoryFile("toolchain.json")) as ToolchainManifest;
}

function healthyProbe(overrides: Partial<ToolchainProbe> = {}): ToolchainProbe {
  return {
    platform: "linux",
    architecture: "x64",
    nodeVersion: "24.18.0",
    corepackVersion: "0.34.6",
    pnpmVersion: "11.8.0",
    pythonVersion: "3.13.5",
    mkdocsVersion: "1.6.1",
    preCommitVersion: "4.6.0",
    hooksReady: true,
    browserPath: "/repo/.boardreadyops/toolchain/cache/puppeteer/chrome",
    browserExecutable: true,
    packageDependenciesInstalled: true,
    ...overrides,
  };
}

describe("reproducible contributor toolchain", () => {
  it("keeps the canonical manifest aligned with package and automation declarations", async () => {
    const config = await manifest();
    const packageJson = JSON.parse(await repositoryFile("package.json")) as {
      packageManager: string;
      engines: { node: string };
      devDependencies: Record<string, string>;
    };
    const requirements = await repositoryFile("docs/requirements.txt");
    const preCommit = await repositoryFile(".pre-commit-config.yaml");
    const workflowFiles = [
      "binary-build.yml",
      "ci.yml",
      "container-build.yml",
      "docs.yml",
      "mutation-nightly.yml",
      "publish-npm.yml",
      "release-please.yml",
      "security.yml",
      "self-validation.yml",
    ];
    const workflows = await Promise.all(workflowFiles.map((file) => repositoryFile(`.github/workflows/${file}`)));
    const ci = workflows[1] ?? "";
    const security = workflows[7] ?? "";

    expect(config.schemaVersion).toBe(1);
    expect(await repositoryFile(".nvmrc")).toBe(`${config.node.preferred}\n`);
    expect(packageJson.packageManager).toMatch(new RegExp(`^pnpm@${config.pnpm.version.replaceAll(".", "\\.")}`));
    expect(packageJson.engines.node).toBe(config.node.engines);
    expect(packageJson.devDependencies.puppeteer).toBe(config.browser.puppeteerVersion);
    expect(requirements).toContain(`mkdocs==${config.python.mkdocs}`);
    expect(requirements).toContain(`mkdocs-material==${config.python.mkdocsMaterial}`);
    expect(requirements).toContain(`mike==${config.python.mike}`);
    expect(preCommit).toContain(`minimum_pre_commit_version: "${config.validation.preCommit}"`);
    expect(preCommit).toContain(`rev: v${config.validation.actionlint}`);
    expect(preCommit).toContain(`rev: v${config.validation.semgrep}`);
    expect(preCommit).toContain(`rev: v${config.validation.gitleaks}`);
    expect(preCommit).toContain(`rev: v${config.validation.zizmor}`);
    for (const workflow of workflows) {
      expect(workflow).toContain(`NODE_VERSION: "${config.node.preferred}"`);
      expect(workflow).not.toContain('NODE_VERSION: "24"');
    }
    expect(ci).toContain(`UV_VERSION: "${config.python.uv}"`);
    expect(security).toContain(`semgrep==${config.validation.semgrep}`);
    expect(security).toContain(`GITLEAKS_VERSION: ${config.validation.gitleaks}`);
    expect(await repositoryFile("apps/web/Dockerfile")).toContain(`FROM node:${config.node.preferred}-slim`);
  });

  it("keeps bootstrap writes inside the repository toolchain directory", async () => {
    const config = await manifest();
    const paths = resolveToolchainPaths("/repo");
    const plan = buildBootstrapPlan(config, paths);

    expect(paths.root).toBe("/repo/.boardreadyops/toolchain");
    expect(plan.every((step) => step.cwd === "/repo" || step.cwd.startsWith(paths.root))).toBe(true);
    expect(plan.flatMap((step) => step.command).join(" ")).not.toMatch(/\bsudo\b|\/usr\/local|corepack enable/u);
    expect(
      plan.some((step) => step.command.join(" ").includes("pnpm install --frozen-lockfile --ignore-scripts")),
    ).toBe(true);
    const hooks = plan.find((step) => step.command.join(" ").includes("pre-commit install-hooks"));
    expect(hooks?.env).toMatchObject({ GOMAXPROCS: "2", GOFLAGS: "-p=2" });
    expect(plan.some((step) => step.command.join(" ").includes("puppeteer browsers install chrome"))).toBe(true);
  });

  it("passes a complete compatible toolchain", async () => {
    const result = evaluateToolchain(await manifest(), healthyProbe());

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails early with actionable missing prerequisite messages", async () => {
    const result = evaluateToolchain(
      await manifest(),
      healthyProbe({
        corepackVersion: undefined,
        pnpmVersion: undefined,
        pythonVersion: "3.10.14",
        hooksReady: false,
        browserPath: undefined,
        browserExecutable: false,
        packageDependenciesInstalled: false,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "corepack", status: "fail", remediation: expect.stringContaining("Corepack") }),
        expect.objectContaining({ id: "pnpm", status: "fail", remediation: expect.stringContaining("bootstrap") }),
        expect.objectContaining({ id: "python", status: "fail", remediation: expect.stringContaining("3.11") }),
        expect.objectContaining({ id: "hooks", status: "fail", remediation: expect.stringContaining("bootstrap") }),
        expect.objectContaining({ id: "browser", status: "fail", remediation: expect.stringContaining("bootstrap") }),
      ]),
    );
  });
});
