#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.dirname(scriptRoot);

export async function loadToolchainManifest(repositoryRoot = defaultRepositoryRoot) {
  return JSON.parse(await readFile(path.join(repositoryRoot, "toolchain.json"), "utf8"));
}

export function resolveToolchainPaths(repositoryRoot, cacheRoot = defaultCacheRoot()) {
  const root = path.join(repositoryRoot, ".boardreadyops", "toolchain");
  const cache = path.join(cacheRoot, "toolchain-v1");
  const venv = path.join(root, "venv");
  const windows = process.platform === "win32";
  const browserRuntime = path.join(cache, "browser-runtime");
  const browserRuntimeRoot = path.join(browserRuntime, "root");
  return {
    repositoryRoot,
    root,
    bin: path.join(root, "bin"),
    cache,
    venv,
    python: path.join(venv, windows ? "Scripts/python.exe" : "bin/python"),
    preCommit: path.join(venv, windows ? "Scripts/pre-commit.exe" : "bin/pre-commit"),
    shellcheck: path.join(venv, windows ? "Scripts/shellcheck.exe" : "bin/shellcheck"),
    uv: path.join(venv, windows ? "Scripts/uv.exe" : "bin/uv"),
    browserPathFile: path.join(root, "browser-path"),
    hooksStamp: path.join(root, "hooks-ready.json"),
    envFile: path.join(root, "env.sh"),
    browserRuntimeRoot,
    browserRuntimeDebs: path.join(browserRuntime, "debs"),
    browserRuntimeStamp: path.join(browserRuntime, "ready.json"),
    browserRuntimeLib: path.join(browserRuntimeRoot, "usr", "lib", "x86_64-linux-gnu"),
    browserRuntimeLibFallback: path.join(browserRuntimeRoot, "lib", "x86_64-linux-gnu"),
  };
}

const modeNormalizationExcludes = new Set([
  ".git",
  ".boardreadyops",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  ".worktrees",
  "worktrees",
]);

export async function normalizeRepositoryModes(repositoryRoot) {
  if (process.platform === "win32") return 0;
  let changed = 0;
  await walkRepositoryDirectories(repositoryRoot, async (directory, info) => {
    if ((info.mode & 0o2000) === 0) return;
    await chmod(directory, info.mode & ~0o2000);
    changed += 1;
  });
  return changed;
}

async function repositoryModesAreNormalized(repositoryRoot) {
  if (process.platform === "win32") return true;
  let normalized = true;
  await walkRepositoryDirectories(repositoryRoot, async (_directory, info) => {
    if ((info.mode & 0o2000) !== 0) normalized = false;
  });
  return normalized;
}

async function walkRepositoryDirectories(repositoryRoot, visitor) {
  async function visit(directory) {
    const info = await lstat(directory);
    await visitor(directory, info);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (modeNormalizationExcludes.has(entry.name)) continue;
      await visit(path.join(directory, entry.name));
    }
  }
  await visit(repositoryRoot);
}

export function buildBootstrapPlan(
  config,
  paths,
  pythonLauncher = resolvePythonLauncher(),
  venvCommand = [pythonLauncher, "-m", "venv", paths.venv],
) {
  const preCommitHome = path.join(paths.cache, "pre-commit");
  const puppeteerCache = path.join(paths.cache, "puppeteer");
  return [
    {
      name: "Install JavaScript dependencies",
      cwd: paths.repositoryRoot,
      command: ["corepack", "pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
    },
    {
      name: "Create Python virtual environment",
      cwd: paths.repositoryRoot,
      command: venvCommand,
    },
    {
      name: "Install pinned Python tooling",
      cwd: paths.repositoryRoot,
      command: [
        paths.python,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        path.join(paths.repositoryRoot, "docs", "requirements.txt"),
        `pre-commit==${config.validation.preCommit}`,
        `shellcheck-py==${config.validation.shellcheck.packageVersion}`,
        `uv==${config.python.uv}`,
      ],
    },
    {
      name: "Prepare pinned validation hooks",
      cwd: paths.repositoryRoot,
      command: [paths.preCommit, "install-hooks"],
      env: { PRE_COMMIT_HOME: preCommitHome, GOMAXPROCS: "2", GOFLAGS: "-p=2" },
    },
    {
      name: "Install Puppeteer Chrome",
      cwd: paths.repositoryRoot,
      command: ["corepack", "pnpm", "exec", "puppeteer", "browsers", "install", config.browser.name],
      env: { PUPPETEER_CACHE_DIR: puppeteerCache },
    },
  ];
}

export function evaluateToolchain(config, probe) {
  const browserReady = Boolean(probe.browserPath) && probe.browserExecutable && Boolean(probe.browserVersion);
  const checks = [
    check(
      "platform",
      ["linux", "darwin", "win32"].includes(probe.platform) && ["x64", "arm64"].includes(probe.architecture),
      `${probe.platform}-${probe.architecture}`,
      "Use Ubuntu 24.04 x64 for the canonical automation environment; macOS and Windows remain supported contributor targets.",
    ),
    check(
      "repository-modes",
      probe.repositoryModesNormalized,
      repositoryModeMessage(probe.repositoryModesNormalized),
      "Run `node scripts/toolchain.mjs bootstrap` to remove host-inherited setgid bits without changing tracked content.",
    ),
    check(
      "node",
      supportsNode(config, probe.nodeVersion),
      `Node ${probe.nodeVersion}`,
      `Install Node ${config.node.preferred} or another runtime allowed by ${config.node.engines}.`,
    ),
    check(
      "corepack",
      Boolean(probe.corepackVersion),
      versionMessage("Corepack", probe.corepackVersion, "Corepack not found"),
      "Install a Node distribution that includes Corepack; do not depend on a host-global pnpm shim.",
    ),
    check(
      "pnpm",
      probe.pnpmVersion === config.pnpm.version,
      versionMessage("pnpm", probe.pnpmVersion, "pnpm not available through Corepack"),
      "Run `node scripts/toolchain.mjs bootstrap` to create the repository-local pnpm wrapper.",
    ),
    check(
      "python",
      supportsPython(config, probe.pythonVersion),
      versionMessage("Python", probe.pythonVersion, "Python not found"),
      `Install Python ${config.python.minimum} through <${config.python.maximumExclusive}, then rerun bootstrap.`,
    ),
    check(
      "dependencies",
      probe.packageDependenciesInstalled,
      availabilityMessage(
        probe.packageDependenciesInstalled,
        "Node dependencies installed",
        "Node dependencies missing",
      ),
      "Run `node scripts/toolchain.mjs bootstrap` before verification.",
    ),
    check(
      "mkdocs",
      probe.mkdocsVersion === config.python.mkdocs,
      versionMessage("MkDocs", probe.mkdocsVersion, "MkDocs not found"),
      "Run the repository-local bootstrap to install pinned documentation dependencies.",
    ),
    check(
      "pre-commit",
      probe.preCommitVersion === config.validation.preCommit,
      versionMessage("pre-commit", probe.preCommitVersion, "pre-commit not found"),
      "Run the repository-local bootstrap to install pre-commit and validation hooks.",
    ),
    check(
      "shellcheck",
      probe.shellcheckVersion === config.validation.shellcheck.version,
      versionMessage("ShellCheck", probe.shellcheckVersion, "ShellCheck not found"),
      "Run the repository-local bootstrap to install the pinned ShellCheck release used by Actionlint.",
    ),
    check(
      "uv",
      probe.uvVersion === config.python.uv,
      versionMessage("uv", probe.uvVersion, "uv not found"),
      "Run the repository-local bootstrap to install the pinned uv release.",
    ),
    check(
      "hooks",
      probe.hooksReady,
      availabilityMessage(
        probe.hooksReady,
        "Pinned validation hooks prepared",
        "Pinned validation hooks are not prepared",
      ),
      "Run `node scripts/toolchain.mjs bootstrap` to prepare Actionlint, Semgrep, Gitleaks, zizmor, and OSV hooks.",
    ),
    check(
      "browser",
      browserReady,
      browserMessage(probe),
      "Run `node scripts/toolchain.mjs bootstrap` to install Puppeteer's pinned Chrome build and user-scoped Ubuntu runtime libraries.",
    ),
  ];
  return { ok: checks.every((entry) => entry.status === "pass"), checks };
}

function repositoryModeMessage(normalized) {
  return availabilityMessage(
    normalized,
    "Repository directory modes normalized",
    "Repository contains inherited setgid directories",
  );
}

function versionMessage(name, version, missingMessage) {
  return version ? `${name} ${version}` : missingMessage;
}

function availabilityMessage(available, presentMessage, missingMessage) {
  return available ? presentMessage : missingMessage;
}

function browserMessage(probe) {
  if (probe.browserPath && probe.browserExecutable && probe.browserVersion) {
    return `Chrome ${probe.browserVersion} (${probe.browserPath})`;
  }
  if (probe.browserPath && probe.browserExecutable) {
    return "Pinned Chrome exists but cannot start with the prepared runtime libraries";
  }
  return "Pinned Chrome executable not found";
}

export async function probeToolchain(config, paths) {
  const env = buildToolchainEnvironment(paths);
  const browserPath = (await readOptional(paths.browserPathFile))?.trim() || undefined;
  const browserExecutable = browserPath ? await isExecutable(browserPath) : false;
  let browserVersion;
  if (browserPath && browserExecutable) {
    if (process.platform === "win32") {
      browserVersion = config.browser.name;
    } else {
      browserVersion = await commandVersion(browserPath, ["--version"], env);
    }
  }
  return {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.versions.node,
    corepackVersion: await commandVersion("corepack", ["--version"], env),
    pnpmVersion: await commandVersion("corepack", ["pnpm", "--version"], env),
    pythonVersion: await firstCommandVersion(
      [
        [paths.python, ["--version"]],
        [resolvePythonLauncher(), ["--version"]],
      ],
      env,
    ),
    mkdocsVersion: await pythonModuleVersion(paths.python, "mkdocs", env),
    preCommitVersion: normalizePrefixedVersion(await commandVersion(paths.preCommit, ["--version"], env), "pre-commit"),
    shellcheckVersion: normalizePrefixedVersion(await commandVersion(paths.shellcheck, ["--version"], env)),
    uvVersion: normalizePrefixedVersion(await commandVersion(paths.uv, ["--version"], env), "uv"),
    hooksReady: await hooksStampMatches(config, paths.hooksStamp),
    browserPath,
    browserExecutable,
    browserVersion,
    packageDependenciesInstalled: await exists(
      path.join(paths.repositoryRoot, "node_modules", ".bin", executableName("puppeteer")),
    ),
    repositoryModesNormalized: await repositoryModesAreNormalized(paths.repositoryRoot),
  };
}

async function bootstrap(config, paths) {
  const pythonSelection = await selectPythonInterpreter(config, process.env, paths.repositoryRoot);
  renderPythonSelection(pythonSelection.attempts);
  const uvVersion = await commandVersion("uv", ["--version"], process.env);
  const venvCommand = buildVirtualEnvironmentCommand(config, paths, pythonSelection.command, uvVersion);
  process.stdout.write(
    `==> Python environment: ${uvVersion === config.python.uv ? `uv ${uvVersion}` : "stdlib venv (pinned uv unavailable)"}\n`,
  );
  const normalizedDirectories = await normalizeRepositoryModes(paths.repositoryRoot);
  if (normalizedDirectories > 0) {
    process.stdout.write(`==> Normalized ${normalizedDirectories} inherited directory mode(s)\n`);
  }
  await Promise.all([mkdir(paths.bin, { recursive: true }), mkdir(paths.cache, { recursive: true })]);
  await writePnpmWrapper(paths);
  for (const step of buildBootstrapPlan(config, paths, pythonSelection.command, venvCommand)) {
    process.stdout.write(`==> ${step.name}\n`);
    await run(step.command[0], step.command.slice(1), {
      cwd: step.cwd,
      env: { ...buildToolchainEnvironment(paths), ...step.env },
    });
  }
  if (process.platform === "linux") {
    process.stdout.write("==> Prepare user-scoped Chrome runtime libraries\n");
  }
  await prepareBrowserRuntime(config, paths);
  const browserPath = await discoverPuppeteerExecutable(paths);
  await writeFile(paths.browserPathFile, `${browserPath}\n`);
  await writeFile(
    paths.hooksStamp,
    `${JSON.stringify({ schemaVersion: 1, preparedAt: new Date().toISOString(), validation: config.validation }, null, 2)}\n`,
  );
  await writeEnvironmentFile(paths, browserPath);
  const result = evaluateToolchain(config, await probeToolchain(config, paths));
  renderDoctor(result);
  if (!result.ok) {
    throw new Error("Toolchain bootstrap completed but validation still failed.");
  }
}

async function prepareBrowserRuntime(config, paths) {
  if (process.platform !== "linux") {
    await mkdir(path.dirname(paths.browserRuntimeStamp), { recursive: true });
    await writeFile(
      paths.browserRuntimeStamp,
      `${JSON.stringify({ schemaVersion: 1, browser: config.browser }, null, 2)}\n`,
    );
    return;
  }
  if (await browserRuntimeStampMatches(config, paths)) return;
  const browserRuntime = path.dirname(paths.browserRuntimeRoot);
  await rm(browserRuntime, { recursive: true, force: true });
  await Promise.all([
    mkdir(paths.browserRuntimeDebs, { recursive: true }),
    mkdir(paths.browserRuntimeRoot, { recursive: true }),
  ]);
  await run("apt-get", ["download", ...config.browser.ubuntuRuntimePackages], {
    cwd: paths.browserRuntimeDebs,
    env: buildToolchainEnvironment(paths),
  });
  const archives = (await readdir(paths.browserRuntimeDebs))
    .filter((entry) => entry.endsWith(".deb"))
    .sort((left, right) => left.localeCompare(right));
  if (archives.length === 0) throw new Error("apt-get download did not produce Chrome runtime packages");
  for (const archive of archives) {
    await run("dpkg-deb", ["-x", path.join(paths.browserRuntimeDebs, archive), paths.browserRuntimeRoot], {
      cwd: paths.browserRuntimeDebs,
      env: buildToolchainEnvironment(paths),
    });
  }
  await writeFile(
    paths.browserRuntimeStamp,
    `${JSON.stringify({ schemaVersion: 1, browser: config.browser }, null, 2)}\n`,
  );
}

async function browserRuntimeStampMatches(config, paths) {
  const raw = await readOptional(paths.browserRuntimeStamp);
  if (!raw) return false;
  if (process.platform === "linux" && !(await exists(paths.browserRuntimeLib))) return false;
  try {
    const stamp = JSON.parse(raw);
    return JSON.stringify(stamp.browser) === JSON.stringify(config.browser);
  } catch {
    return false;
  }
}

async function discoverPuppeteerExecutable(paths) {
  process.env.PUPPETEER_CACHE_DIR = path.join(paths.cache, "puppeteer");
  const { default: puppeteer } = await import("puppeteer");
  const executable = await puppeteer.executablePath();
  if (!executable || !(await isExecutable(executable))) {
    throw new Error(`Puppeteer did not expose an executable Chrome path: ${executable || "(empty)"}`);
  }
  return executable;
}

async function writePnpmWrapper(paths) {
  const wrapper = path.join(paths.bin, executableName("pnpm"));
  if (process.platform === "win32") {
    await writeFile(wrapper, "@echo off\r\ncorepack pnpm %*\r\n");
  } else {
    await writeFile(wrapper, '#!/usr/bin/env sh\nexec corepack pnpm "$@"\n');
    await chmod(wrapper, 0o755);
  }
}

async function writeEnvironmentFile(paths, browserPath) {
  const browserRuntimePath = [paths.browserRuntimeLib, paths.browserRuntimeLibFallback].join(":");
  const repositoryToolPath = [paths.bin, path.join(paths.venv, "bin")].join(":");
  const databaseUrl = process.env.DATABASE_URL || "postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_toolchain";
  const quotedBrowserRuntimePath = shellQuote(browserRuntimePath);
  const quotedRepositoryToolPath = shellQuote(repositoryToolPath);
  const lines = [
    "# Generated by scripts/toolchain.mjs. Do not edit.",
    `export BOARDREADYOPS_TOOLCHAIN_ROOT=${shellQuote(paths.root)}`,
    `export VIRTUAL_ENV=${shellQuote(paths.venv)}`,
    `export PRE_COMMIT_HOME=${shellQuote(path.join(paths.cache, "pre-commit"))}`,
    `export PUPPETEER_CACHE_DIR=${shellQuote(path.join(paths.cache, "puppeteer"))}`,
    `export PA11Y_CHROME_PATH=${shellQuote(browserPath)}`,
    `export LD_LIBRARY_PATH=${quotedBrowserRuntimePath}:"\${LD_LIBRARY_PATH:-}"`,
    `export DATABASE_URL=${shellQuote(databaseUrl)}`,
    "export ALLOW_MAJOR_RELEASE=true",
    `export PATH=${quotedRepositoryToolPath}:"$PATH"`,
    "",
  ];
  await writeFile(paths.envFile, lines.join("\n"));
}

export function buildToolchainEnvironment(paths, baseEnvironment = process.env) {
  const pathEntries = [paths.bin, path.join(paths.venv, process.platform === "win32" ? "Scripts" : "bin")];
  const browserLibraries = [paths.browserRuntimeLib, paths.browserRuntimeLibFallback, baseEnvironment.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return {
    ...baseEnvironment,
    BOARDREADYOPS_TOOLCHAIN_ROOT: paths.root,
    VIRTUAL_ENV: paths.venv,
    PRE_COMMIT_HOME: path.join(paths.cache, "pre-commit"),
    PUPPETEER_CACHE_DIR: path.join(paths.cache, "puppeteer"),
    LD_LIBRARY_PATH: browserLibraries,
    DATABASE_URL: baseEnvironment.DATABASE_URL || "postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_toolchain",
    ALLOW_MAJOR_RELEASE: "true",
    PATH: `${pathEntries.join(path.delimiter)}${path.delimiter}${baseEnvironment.PATH ?? ""}`,
  };
}

async function runWithToolchain(paths, command) {
  if (command.length === 0) {
    throw new Error("toolchain run requires a command");
  }
  await normalizeRepositoryModes(paths.repositoryRoot);
  const env = buildToolchainEnvironment(paths);
  const browserPath = (await readOptional(paths.browserPathFile))?.trim();
  if (browserPath) {
    env.PA11Y_CHROME_PATH = browserPath;
  }
  const child = spawn(command[0], command.slice(1), { cwd: paths.repositoryRoot, env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value, signal) => resolve(value ?? (signal ? 1 : 0)));
  });
  process.exitCode = code;
}

function renderDoctor(result) {
  for (const entry of result.checks) {
    const marker = entry.status === "pass" ? "PASS" : "FAIL";
    process.stdout.write(`${marker.padEnd(4)} ${entry.id.padEnd(14)} ${entry.message}\n`);
    if (entry.status === "fail" && entry.remediation) {
      process.stdout.write(`     remediation: ${entry.remediation}\n`);
    }
  }
}

function check(id, passed, message, remediation) {
  return { id, status: passed ? "pass" : "fail", message, ...(passed ? {} : { remediation }) };
}

function supportsNode(config, version) {
  const [major, minor = 0] = numericVersion(version);
  if (!config.node.supportedMajors.includes(major)) return false;
  return major !== 22 || minor >= 14;
}

function supportsPython(config, version) {
  if (!version) return false;
  const current = numericVersion(version);
  return (
    compareVersion(current, numericVersion(config.python.minimum)) >= 0 &&
    compareVersion(current, numericVersion(config.python.maximumExclusive)) < 0
  );
}

function numericVersion(version) {
  const extracted = extractVersion(version, 1, 4);
  return extracted ? extracted.split(".").map(Number) : [0];
}

function compareVersion(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

async function pythonModuleVersion(python, module, env) {
  if (!(await exists(python))) return undefined;
  const value = await commandVersion(python, ["-m", module, "--version"], env);
  return extractVersion(value, 3, 3);
}

async function firstCommandVersion(candidates, env) {
  for (const [command, args] of candidates) {
    const version = await commandVersion(command, args, env);
    if (version) return version;
  }
  return undefined;
}

async function commandVersion(command, args, env) {
  try {
    const result = await capture(command, args, { cwd: defaultRepositoryRoot, env });
    return normalizePrefixedVersion(`${result.stdout}\n${result.stderr}`.trim());
  } catch {
    const isWin = process.platform === "win32";
    if (isWin && !command.includes(".") && !command.includes("/") && !command.includes("\\")) {
      try {
        const result = await capture(`${command}.cmd`, args, { cwd: defaultRepositoryRoot, env });
        return normalizePrefixedVersion(`${result.stdout}\n${result.stderr}`.trim());
      } catch {}
    }
    return undefined;
  }
}

function normalizePrefixedVersion(value, prefix) {
  if (!value) return undefined;
  return extractVersion(value, 2, 4) ?? (prefix ? value.replace(prefix, "").trim() : value.trim());
}

function extractVersion(value, minimumSegments, maximumSegments) {
  const input = String(value ?? "");
  for (let start = 0; start < input.length; start += 1) {
    if (!isAsciiDigit(input[start])) continue;
    let cursor = start;
    let segments = 0;
    while (segments < maximumSegments) {
      while (cursor < input.length && isAsciiDigit(input[cursor])) cursor += 1;
      segments += 1;
      const hasAnotherSegment = input[cursor] === "." && isAsciiDigit(input[cursor + 1]);
      if (!hasAnotherSegment || segments === maximumSegments) break;
      cursor += 1;
    }
    if (segments >= minimumSegments) return input.slice(start, cursor);
  }
  return undefined;
}

function isAsciiDigit(character) {
  return character !== undefined && character >= "0" && character <= "9";
}

function defaultCacheRoot() {
  const base =
    process.env.BOARDREADYOPS_TOOLCHAIN_CACHE_DIR || process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "boardreadyops");
}

export async function selectPythonInterpreter(config, env = process.env, cwd = defaultRepositoryRoot) {
  const candidates = pythonCandidates(config, env);
  const attempts = [];
  for (const candidate of candidates) {
    const result = await probePythonCandidate(config, candidate, env, cwd);
    attempts.push(result);
    if (result.status === "selected") {
      return { command: candidate.command, version: result.version, source: candidate.source, attempts };
    }
  }

  const remediation = pythonRemediation(config, process.platform);
  throw new Error(
    [
      "No usable Python interpreter was found for the repository toolchain.",
      ...attempts.map(formatPythonAttempt),
      `Remediation: ${remediation}`,
    ].join("\n"),
  );
}

function pythonCandidates(config, env) {
  const override = env.BOARDREADYOPS_PYTHON?.trim();
  if (override) return [{ command: override, source: "BOARDREADYOPS_PYTHON" }];
  const commands = [`python${config.python.preferred}`, "python3", "python"];
  return [...new Set(commands)].map((command) => ({ command, source: "auto" }));
}

async function probePythonCandidate(config, candidate, env, cwd) {
  let version;
  try {
    const result = await capture(candidate.command, ["--version"], { cwd, env });
    version = normalizePrefixedVersion(`${result.stdout}\n${result.stderr}`.trim());
  } catch (error) {
    return rejectedPythonCandidate(candidate, undefined, `not available: ${diagnosticReason(error)}`);
  }
  if (!version || !supportsPython(config, version)) {
    return rejectedPythonCandidate(
      candidate,
      version,
      `unsupported version; expected ${config.python.minimum} through <${config.python.maximumExclusive}`,
    );
  }

  try {
    await capture(candidate.command, ["-c", "import subprocess; print('subprocess:ok')"], { cwd, env });
  } catch (error) {
    return rejectedPythonCandidate(candidate, version, `subprocess capability failed: ${diagnosticReason(error)}`);
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-python-probe-"));
  const probeVenv = path.join(temporaryRoot, "venv");
  try {
    try {
      await capture(candidate.command, ["-m", "venv", probeVenv], { cwd, env });
    } catch (error) {
      return rejectedPythonCandidate(
        candidate,
        version,
        `virtual-environment creation failed: ${diagnosticReason(error)}`,
      );
    }
    const probePython = path.join(probeVenv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    try {
      await capture(probePython, ["-m", "pip", "--version"], { cwd, env });
    } catch (error) {
      return rejectedPythonCandidate(
        candidate,
        version,
        `package installer (pip) unavailable in created virtual environment: ${diagnosticReason(error)}`,
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return { ...candidate, version, status: "selected" };
}

function rejectedPythonCandidate(candidate, version, reason) {
  return { ...candidate, version, status: "rejected", reason };
}

function renderPythonSelection(attempts) {
  for (const attempt of attempts) {
    process.stdout.write(`${formatPythonAttempt(attempt)}\n`);
  }
}

function formatPythonAttempt(attempt) {
  const source = attempt.source === "BOARDREADYOPS_PYTHON" ? " (BOARDREADYOPS_PYTHON)" : "";
  if (attempt.status === "selected") {
    return `Python candidate ${attempt.command}${source}: selected (Python ${attempt.version})`;
  }
  const version = attempt.version ? `Python ${attempt.version}; ` : "";
  return `Python candidate ${attempt.command}${source}: rejected (${version}${attempt.reason})`;
}

function diagnosticReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, " ").trim();
}

function pythonRemediation(config, platform) {
  const override = "set BOARDREADYOPS_PYTHON=/path/to/python to choose a known-good interpreter";
  if (platform === "linux") {
    return `install Python ${config.python.minimum} through <${config.python.maximumExclusive} with subprocess, venv, and pip support (Ubuntu/Debian: sudo apt-get install python3 python3-venv python3-pip), or ${override}.`;
  }
  if (platform === "darwin") {
    return `install a supported Python with Homebrew (brew install python@${config.python.preferred}), or ${override}.`;
  }
  if (platform === "win32") {
    return `install Python ${config.python.preferred} (winget install Python.Python.3.13), then ${override}.`;
  }
  return `install a complete supported Python runtime with subprocess, venv, and pip support, or ${override}.`;
}

export function buildVirtualEnvironmentCommand(config, paths, pythonLauncher, uvVersion) {
  if (uvVersion === config.python.uv) {
    return ["uv", "venv", "--python", pythonLauncher, "--seed", paths.venv];
  }
  return [pythonLauncher, "-m", "venv", paths.venv];
}

function resolvePythonLauncher(env = process.env) {
  return env.BOARDREADYOPS_PYTHON || (process.platform === "win32" ? "python" : "python3");
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function hooksStampMatches(config, file) {
  const raw = await readOptional(file);
  if (!raw) return false;
  try {
    const stamp = JSON.parse(raw);
    return JSON.stringify(stamp.validation) === JSON.stringify(config.validation);
  } catch {
    return false;
  }
}

async function exists(file) {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(file) {
  try {
    await access(file, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export function buildCorepackInstallCommand(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", "corepack install"],
      windowsVerbatimArguments: true,
    };
  }
  return { command: "corepack", args: ["install"] };
}

export async function installCorepackWithRetry({
  cwd = defaultRepositoryRoot,
  env = process.env,
  platform = process.platform,
  attempts = 3,
  retryDelayMs = Number(env.BOARDREADYOPS_COREPACK_RETRY_DELAY_MS ?? 1000),
} = {}) {
  const corepackInstall = buildCorepackInstallCommand(platform, env);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run(corepackInstall.command, corepackInstall.args, { cwd, env });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = Math.max(0, retryDelayMs) * attempt;
      process.stderr.write(`Corepack install attempt ${attempt}/${attempts} failed; retrying in ${delayMs}ms.\n`);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Corepack install failed after ${attempts} attempts: ${diagnosticReason(lastError)}`);
}

function quoteWindowsArg(arg) {
  if (!arg) return '""';
  if (/[\s"&|<>^%]/.test(arg)) {
    return `"${arg.replaceAll('"', '""')}"`;
  }
  return arg;
}

function resolveExecutableInvocation(command, args, env = process.env) {
  if (process.platform === "win32") {
    const lower = String(command).toLowerCase();
    const base = path.basename(lower);
    if (
      lower === "corepack" ||
      lower === "pnpm" ||
      base === "corepack.cmd" ||
      base === "pnpm.cmd" ||
      base === "corepack.bat" ||
      base === "pnpm.bat" ||
      base.endsWith(".cmd") ||
      base.endsWith(".bat")
    ) {
      const comspec = env.ComSpec || env.COMSPEC || "cmd.exe";
      const fullCmd = [command, ...args.map(quoteWindowsArg)].join(" ");
      return { command: comspec, args: ["/d", "/s", "/c", fullCmd], windowsVerbatimArguments: true };
    }
  }
  return { command, args };
}

async function run(command, args, options) {
  const invocation = resolveExecutableInvocation(command, args, options?.env);
  const child = spawn(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value, signal) => resolve(value ?? (signal ? 1 : 0)));
  });
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
}

async function capture(command, args, options) {
  const invocation = resolveExecutableInvocation(command, args, options?.env);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      ...options,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function shellQuote(value) {
  const escaped = String(value).replaceAll("'", "'\"'\"'");
  return `'${escaped}'`;
}

async function main() {
  const [command = "doctor", ...args] = process.argv.slice(2);
  const repositoryRoot = process.cwd();
  const config = await loadToolchainManifest(repositoryRoot);
  const paths = resolveToolchainPaths(repositoryRoot);
  if (command === "bootstrap") {
    await bootstrap(config, paths);
    return;
  }
  if (command === "doctor") {
    const result = evaluateToolchain(config, await probeToolchain(config, paths));
    renderDoctor(result);
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (args.includes("--strict") && !result.ok) process.exitCode = 1;
    return;
  }
  if (command === "corepack-install") {
    await installCorepackWithRetry({ cwd: repositoryRoot, env: process.env });
    return;
  }
  if (command === "run") {
    await runWithToolchain(paths, args);
    return;
  }
  if (command === "print-env") {
    process.stdout.write(`${paths.envFile}\n`);
    return;
  }
  throw new Error(`Unknown toolchain command: ${command}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
