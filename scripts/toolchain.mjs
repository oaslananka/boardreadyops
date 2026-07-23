#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

const modeNormalizationExcludes = new Set([".git", ".boardreadyops", "node_modules"]);

export async function normalizeRepositoryModes(repositoryRoot) {
  let changed = 0;
  await walkRepositoryDirectories(repositoryRoot, async (directory, info) => {
    if ((info.mode & 0o2000) === 0) return;
    await chmod(directory, info.mode & ~0o2000);
    changed += 1;
  });
  return changed;
}

async function repositoryModesAreNormalized(repositoryRoot) {
  let normalized = true;
  await walkRepositoryDirectories(repositoryRoot, async (_directory, info) => {
    if ((info.mode & 0o2000) !== 0) normalized = false;
  });
  return normalized;
}

async function walkRepositoryDirectories(repositoryRoot, visitor) {
  async function visit(directory, isRoot = false) {
    const info = await lstat(directory);
    await visitor(directory, info);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isRoot && modeNormalizationExcludes.has(entry.name)) continue;
      await visit(path.join(directory, entry.name));
    }
  }
  await visit(repositoryRoot, true);
}

export function buildBootstrapPlan(config, paths) {
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
      command: [resolvePythonLauncher(), "-m", "venv", paths.venv],
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
  const checks = [];
  checks.push(
    check(
      "platform",
      ["linux", "darwin", "win32"].includes(probe.platform) && ["x64", "arm64"].includes(probe.architecture),
      `${probe.platform}-${probe.architecture}`,
      "Use Ubuntu 24.04 x64 for the canonical automation environment; macOS and Windows remain supported contributor targets.",
    ),
  );
  checks.push(
    check(
      "repository-modes",
      probe.repositoryModesNormalized,
      probe.repositoryModesNormalized
        ? "Repository directory modes normalized"
        : "Repository contains inherited setgid directories",
      "Run `node scripts/toolchain.mjs bootstrap` to remove host-inherited setgid bits without changing tracked content.",
    ),
  );
  checks.push(
    check(
      "node",
      supportsNode(config, probe.nodeVersion),
      `Node ${probe.nodeVersion}`,
      `Install Node ${config.node.preferred} or another runtime allowed by ${config.node.engines}.`,
    ),
  );
  checks.push(
    check(
      "corepack",
      Boolean(probe.corepackVersion),
      probe.corepackVersion ? `Corepack ${probe.corepackVersion}` : "Corepack not found",
      "Install a Node distribution that includes Corepack; do not depend on a host-global pnpm shim.",
    ),
  );
  checks.push(
    check(
      "pnpm",
      probe.pnpmVersion === config.pnpm.version,
      probe.pnpmVersion ? `pnpm ${probe.pnpmVersion}` : "pnpm not available through Corepack",
      "Run `node scripts/toolchain.mjs bootstrap` to create the repository-local pnpm wrapper.",
    ),
  );
  checks.push(
    check(
      "python",
      supportsPython(config, probe.pythonVersion),
      probe.pythonVersion ? `Python ${probe.pythonVersion}` : "Python not found",
      `Install Python ${config.python.minimum} through <${config.python.maximumExclusive}, then rerun bootstrap.`,
    ),
  );
  checks.push(
    check(
      "dependencies",
      probe.packageDependenciesInstalled,
      probe.packageDependenciesInstalled ? "Node dependencies installed" : "Node dependencies missing",
      "Run `node scripts/toolchain.mjs bootstrap` before verification.",
    ),
  );
  checks.push(
    check(
      "mkdocs",
      probe.mkdocsVersion === config.python.mkdocs,
      probe.mkdocsVersion ? `MkDocs ${probe.mkdocsVersion}` : "MkDocs not found",
      "Run the repository-local bootstrap to install pinned documentation dependencies.",
    ),
  );
  checks.push(
    check(
      "pre-commit",
      probe.preCommitVersion === config.validation.preCommit,
      probe.preCommitVersion ? `pre-commit ${probe.preCommitVersion}` : "pre-commit not found",
      "Run the repository-local bootstrap to install pre-commit and validation hooks.",
    ),
  );
  checks.push(
    check(
      "uv",
      probe.uvVersion === config.python.uv,
      probe.uvVersion ? `uv ${probe.uvVersion}` : "uv not found",
      "Run the repository-local bootstrap to install the pinned uv release.",
    ),
  );
  checks.push(
    check(
      "hooks",
      probe.hooksReady,
      probe.hooksReady ? "Pinned validation hooks prepared" : "Pinned validation hooks are not prepared",
      "Run `node scripts/toolchain.mjs bootstrap` to prepare Actionlint, Semgrep, Gitleaks, zizmor, and OSV hooks.",
    ),
  );
  checks.push(
    check(
      "browser",
      Boolean(probe.browserPath) && probe.browserExecutable && Boolean(probe.browserVersion),
      probe.browserPath && probe.browserExecutable && probe.browserVersion
        ? `Chrome ${probe.browserVersion} (${probe.browserPath})`
        : probe.browserPath && probe.browserExecutable
          ? "Pinned Chrome exists but cannot start with the prepared runtime libraries"
          : "Pinned Chrome executable not found",
      "Run `node scripts/toolchain.mjs bootstrap` to install Puppeteer's pinned Chrome build and user-scoped Ubuntu runtime libraries.",
    ),
  );
  return { ok: checks.every((entry) => entry.status === "pass"), checks };
}

export async function probeToolchain(config, paths) {
  const env = buildToolchainEnvironment(paths);
  const browserPath = (await readOptional(paths.browserPathFile))?.trim() || undefined;
  const browserExecutable = browserPath ? await isExecutable(browserPath) : false;
  const browserVersion =
    browserPath && browserExecutable ? await commandVersion(browserPath, ["--version"], env) : undefined;
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
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "Canonical non-interactive bootstrap currently supports Linux x64 (Ubuntu 24.04). See docs/development/toolchain.md for other platforms.",
    );
  }
  const normalizedDirectories = await normalizeRepositoryModes(paths.repositoryRoot);
  if (normalizedDirectories > 0) {
    process.stdout.write(`==> Normalized ${normalizedDirectories} inherited directory mode(s)\n`);
  }
  await Promise.all([mkdir(paths.bin, { recursive: true }), mkdir(paths.cache, { recursive: true })]);
  await writePnpmWrapper(paths);
  for (const step of buildBootstrapPlan(config, paths)) {
    process.stdout.write(`==> ${step.name}\n`);
    await run(step.command[0], step.command.slice(1), {
      cwd: step.cwd,
      env: { ...buildToolchainEnvironment(paths), ...step.env },
    });
  }
  process.stdout.write("==> Prepare user-scoped Chrome runtime libraries\n");
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
  if (!raw || !(await exists(paths.browserRuntimeLib))) return false;
  try {
    const stamp = JSON.parse(raw);
    return JSON.stringify(stamp.browser) === JSON.stringify(config.browser);
  } catch {
    return false;
  }
}

async function discoverPuppeteerExecutable(paths) {
  const script = "import('puppeteer').then(async ({default:p})=>process.stdout.write(await p.executablePath()))";
  const result = await capture("corepack", ["pnpm", "exec", "node", "-e", script], {
    cwd: paths.repositoryRoot,
    env: buildToolchainEnvironment(paths),
  });
  const executable = result.stdout.trim();
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
  const lines = [
    "# Generated by scripts/toolchain.mjs. Do not edit.",
    `export BOARDREADYOPS_TOOLCHAIN_ROOT=${shellQuote(paths.root)}`,
    `export VIRTUAL_ENV=${shellQuote(paths.venv)}`,
    `export PRE_COMMIT_HOME=${shellQuote(path.join(paths.cache, "pre-commit"))}`,
    `export PUPPETEER_CACHE_DIR=${shellQuote(path.join(paths.cache, "puppeteer"))}`,
    `export PA11Y_CHROME_PATH=${shellQuote(browserPath)}`,
    `export LD_LIBRARY_PATH=${shellQuote(`${paths.browserRuntimeLib}:${paths.browserRuntimeLibFallback}`)}:"\${LD_LIBRARY_PATH:-}"`,
    `export DATABASE_URL=${shellQuote(process.env.DATABASE_URL || "postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_toolchain")}`,
    "export ALLOW_MAJOR_RELEASE=true",
    `export PATH=${shellQuote(`${paths.bin}:${path.join(paths.venv, "bin")}`)}:"$PATH"`,
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
  return (
    String(version)
      .replace(/^v/u, "")
      .match(/\d+(?:\.\d+)*/u)?.[0]
      ?.split(".")
      .map(Number) ?? [0]
  );
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
  return value?.match(/\d+\.\d+\.\d+/u)?.[0];
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
    return undefined;
  }
}

function normalizePrefixedVersion(value, prefix) {
  if (!value) return undefined;
  const match = value.match(/\d+(?:\.\d+){1,3}/u);
  return match?.[0] ?? (prefix ? value.replace(prefix, "").trim() : value.trim());
}

function defaultCacheRoot() {
  const base =
    process.env.BOARDREADYOPS_TOOLCHAIN_CACHE_DIR || process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "boardreadyops");
}

function resolvePythonLauncher() {
  return process.env.BOARDREADYOPS_PYTHON || (process.platform === "win32" ? "python" : "python3");
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
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function run(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value, signal) => resolve(value ?? (signal ? 1 : 0)));
  });
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
}

async function capture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
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
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
