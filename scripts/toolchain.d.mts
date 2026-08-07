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
    shellcheck: {
      version: string;
      packageVersion: string;
    };
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
    ubuntuRuntimePackages: string[];
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
  shellcheck: string;
  uv: string;
  browserPathFile: string;
  hooksStamp: string;
  envFile: string;
  browserRuntimeRoot: string;
  browserRuntimeDebs: string;
  browserRuntimeStamp: string;
  browserRuntimeLib: string;
  browserRuntimeLibFallback: string;
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
  shellcheckVersion: string | undefined;
  uvVersion: string | undefined;
  hooksReady: boolean;
  browserPath: string | undefined;
  browserExecutable: boolean;
  browserVersion: string | undefined;
  packageDependenciesInstalled: boolean;
  repositoryModesNormalized: boolean;
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

export interface PythonSelectionAttempt {
  command: string;
  source: "BOARDREADYOPS_PYTHON" | "auto";
  version?: string;
  status: "selected" | "rejected";
  reason?: string;
}

export interface PythonSelection {
  command: string;
  version: string;
  source: "BOARDREADYOPS_PYTHON" | "auto";
  attempts: PythonSelectionAttempt[];
}

export function resolveToolchainPaths(repositoryRoot: string, cacheRoot?: string): ToolchainPaths;
export function normalizeRepositoryModes(repositoryRoot: string): Promise<number>;
export function buildToolchainEnvironment(
  paths: ToolchainPaths,
  baseEnvironment?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function buildBootstrapPlan(
  config: ToolchainManifest,
  paths: ToolchainPaths,
  pythonLauncher?: string,
  venvCommand?: string[],
): BootstrapStep[];
export function evaluateToolchain(config: ToolchainManifest, probe: ToolchainProbe): ToolchainResult;
export function loadToolchainManifest(repositoryRoot?: string): Promise<ToolchainManifest>;
export function probeToolchain(config: ToolchainManifest, paths: ToolchainPaths): Promise<ToolchainProbe>;

export function selectPythonInterpreter(
  config: ToolchainManifest,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<PythonSelection>;
export function buildVirtualEnvironmentCommand(
  config: ToolchainManifest,
  paths: ToolchainPaths,
  pythonLauncher: string,
  uvVersion: string | undefined,
): string[];
