export interface ToolchainManifest {
  schemaVersion: 1;
  node: {
    preferred: string;
    engines: string;
    supportedMajors: number[];
  };
  pnpm: { version: string };
  python: {
    preferred: string;
    minimum: string;
    maximumExclusive: string;
    uv: string;
    mkdocs: string;
    mkdocsMaterial: string;
    mike: string;
  };
  validation: {
    preCommit: string;
    uv: string;
    uv: string;
    actionlint: string;
    semgrep: string;
    gitleaks: string;
    zizmor: string;
    osvScanner: string;
  };
  browser: {
    provider: "puppeteer";
    name: "chrome";
    puppeteerVersion: string;
  };
}

export interface ToolchainPaths {
  repositoryRoot: string;
  root: string;
  bin: string;
  cache: string;
  venv: string;
  python: string;
  preCommit: string;
  uv: string;
  uv: string;
  browserPathFile: string;
  hooksStamp: string;
  envFile: string;
}

export interface BootstrapStep {
  name: string;
  cwd: string;
  command: string[];
  env?: Record<string, string>;
}

export interface ToolchainProbe {
  platform: string;
  architecture: string;
  nodeVersion: string;
  corepackVersion: string | undefined;
  pnpmVersion: string | undefined;
  pythonVersion: string | undefined;
  mkdocsVersion: string | undefined;
  preCommitVersion: string | undefined;
  uvVersion: string | undefined;
  uvVersion: string | undefined;
  hooksReady: boolean;
  browserPath: string | undefined;
  browserExecutable: boolean;
  packageDependenciesInstalled: boolean;
}

export interface ToolchainCheck {
  id: string;
  status: "pass" | "fail";
  message: string;
  remediation?: string;
}

export interface ToolchainResult {
  ok: boolean;
  checks: ToolchainCheck[];
}

export function resolveToolchainPaths(repositoryRoot: string): ToolchainPaths;
export function buildBootstrapPlan(config: ToolchainManifest, paths: ToolchainPaths): BootstrapStep[];
export function evaluateToolchain(config: ToolchainManifest, probe: ToolchainProbe): ToolchainResult;
export function loadToolchainManifest(repositoryRoot?: string): Promise<ToolchainManifest>;
export function probeToolchain(config: ToolchainManifest, paths: ToolchainPaths): Promise<ToolchainProbe>;
