import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBootstrapPlan,
  buildCorepackInstallCommand,
  buildToolchainEnvironment,
  buildVirtualEnvironmentCommand,
  evaluateToolchain,
  normalizeRepositoryModes,
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

type FakePythonOptions = {
  version?: string;
  subprocess?: "ok" | "missing";
  venv?: "ok" | "missing";
  pip?: "ok" | "missing";
};

async function writeFakePython(file: string, options: FakePythonOptions = {}): Promise<void> {
  const version = options.version ?? "3.13.12";
  const subprocess = options.subprocess ?? "ok";
  const venv = options.venv ?? "ok";
  const pip = options.pip ?? "ok";
  const pipBody =
    pip === "ok"
      ? 'echo "pip 25.3 from fake/site-packages/pip (python 3.13)"; exit 0'
      : 'echo "No module named pip" >&2; exit 1';
  await writeFile(
    file,
    `#!/usr/bin/env sh
if [ "$1" = "--version" ]; then
  echo "Python ${version}"
  exit 0
fi
if [ "$1" = "-c" ]; then
  ${subprocess === "ok" ? 'echo "subprocess:ok"; exit 0' : 'echo "ModuleNotFoundError: No module named _posixsubprocess" >&2; exit 1'}
fi
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  ${
    venv === "ok"
      ? `target="$3"
  mkdir -p "$target/bin"
  cat > "$target/bin/python" <<'FAKEPY'
#!/usr/bin/env sh
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  ${pipBody}
fi
exit 2
FAKEPY
  chmod +x "$target/bin/python"
  exit 0`
      : 'echo "No module named venv" >&2; exit 1'
  }
fi
exit 2
`,
  );
  await chmod(file, 0o755);
}

async function writeFailingCorepack(bin: string, marker: string): Promise<void> {
  const corepack = path.join(bin, "corepack");
  await writeFile(
    corepack,
    `#!/usr/bin/env sh
touch "${marker}"
exit 93
`,
  );
  await chmod(corepack, 0o755);
}

async function writeRetryingCorepack(bin: string, counterFile: string, failuresBeforeSuccess: number): Promise<void> {
  const corepack = path.join(bin, "corepack");
  await writeFile(
    corepack,
    `#!/usr/bin/env sh
count=0
if [ -f "${counterFile}" ]; then
  count=$(cat "${counterFile}")
fi
count=$((count + 1))
printf '%s\n' "$count" > "${counterFile}"
if [ "$count" -le "${failuresBeforeSuccess}" ]; then
  echo "simulated transient corepack failure $count" >&2
  exit 93
fi
echo "simulated corepack success $count"
exit 0
`,
  );
  await chmod(corepack, 0o755);
}

function healthyProbe(overrides: Partial<ToolchainProbe> = {}): ToolchainProbe {
  return {
    platform: "linux",
    architecture: "x64",
    nodeVersion: "24.19.0",
    corepackVersion: "0.34.6",
    pnpmVersion: "11.8.0",
    pythonVersion: "3.13.5",
    mkdocsVersion: "1.6.1",
    preCommitVersion: "4.6.0",
    shellcheckVersion: "0.11.0",
    uvVersion: "0.11.16",
    hooksReady: true,
    browserPath: "/repo/.boardreadyops/toolchain/cache/puppeteer/chrome",
    browserExecutable: true,
    browserVersion: "Google Chrome for Testing 150.0.7871.24",
    packageDependenciesInstalled: true,
    repositoryModesNormalized: true,
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
    const requirementsLock = await repositoryFile("docs/requirements.lock.txt");
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
    expect(config.browser.ubuntuRuntimePackages).toEqual([
      "libatk1.0-0t64",
      "libatk-bridge2.0-0t64",
      "libxcomposite1",
      "libxdamage1",
      "libxfixes3",
      "libxrandr2",
      "libgbm1",
      "libatspi2.0-0t64",
      "libcairo2",
      "libpango-1.0-0",
      "libxcb-render0",
      "libxcb-shm0",
      "libpixman-1-0",
      "libthai0",
      "libdatrie1",
    ]);
    expect(requirements).toContain(`mkdocs==${config.python.mkdocs}`);
    expect(requirements).toContain(`mkdocs-material==${config.python.mkdocsMaterial}`);
    expect(requirements).toContain(`mike==${config.python.mike}`);
    expect(requirementsLock).toContain("--generate-hashes");
    for (const workflow of workflows) {
      expect(workflow).not.toContain(
        ['uv pip install --python "$', '{docs_venv}/bin/python" -r docs/requirements.txt'].join(""),
      );
    }
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
    expect(JSON.parse(await repositoryFile("biome.json")).files.includes).toContain("!.boardreadyops");
    expect(JSON.parse(await repositoryFile("knip.json")).ignoreBinaries).not.toContain("mkdocs");
  });

  it("routes Husky hooks through Corepack and the repository-local Python toolchain", async () => {
    const commitMsg = await repositoryFile(".husky/commit-msg");
    const preCommit = await repositoryFile(".husky/pre-commit");
    const prePush = await repositoryFile(".husky/pre-push");
    const packageJson = JSON.parse(await repositoryFile("package.json")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["hook:commitlint"]).toBe("commitlint");
    expect(packageJson.scripts["hook:lint-staged"]).toBe("lint-staged");
    expect(commitMsg).toContain('corepack pnpm run hook:commitlint --edit "$1"');
    expect(preCommit).toContain("corepack pnpm run hook:lint-staged");
    expect(preCommit).toContain("node scripts/toolchain.mjs run pre-commit run --hook-stage pre-commit");
    expect(preCommit).toContain("corepack pnpm run toolchain:bootstrap");
    expect(prePush).toMatch(/^set -e\n/u);
    expect(prePush).toContain("corepack pnpm run typecheck");
    expect(prePush).toContain("corepack pnpm run test:unit");
    expect(prePush).toContain("corepack pnpm run verify:dist");
    expect(prePush).toContain("node scripts/toolchain.mjs run pre-commit run --hook-stage pre-push --all-files");
    expect(prePush).toContain("corepack pnpm run toolchain:bootstrap");

    for (const hook of [commitMsg, preCommit, prePush]) {
      expect(hook).not.toMatch(/(^|\n)pnpm\b/);
      expect(hook).not.toMatch(/(^|\n)pre-commit\b/);
    }
  });

  it.skipIf(process.platform === "win32")("fails pre-push immediately when unit tests fail", async () => {
    const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-pre-push-test-"));
    const bin = path.join(temporaryRoot, "bin");
    const trace = path.join(temporaryRoot, "trace.log");
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(bin, "corepack"),
      `#!/usr/bin/env sh
echo "corepack $*" >> "${trace}"
case "$*" in
  "pnpm run typecheck") exit 0 ;;
  "pnpm run test:unit") exit 42 ;;
  "pnpm run verify:dist") exit 0 ;;
  *) exit 97 ;;
esac
`,
    );
    await writeFile(
      path.join(bin, "node"),
      `#!/usr/bin/env sh
echo "node $*" >> "${trace}"
exit 0
`,
    );
    await chmod(path.join(bin, "corepack"), 0o755);
    await chmod(path.join(bin, "node"), 0o755);

    try {
      const result = spawnSync("sh", [path.join(root, ".husky", "pre-push")], {
        cwd: root,
        env: { ...process.env, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` },
        encoding: "utf8",
      });
      const calls = (await readFile(trace, "utf8")).trim().split("\n");

      expect(result.status).toBe(42);
      expect(calls).toEqual(["corepack pnpm run typecheck", "corepack pnpm run test:unit"]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("uses cmd.exe for Corepack shim execution on Windows", () => {
    expect(buildCorepackInstallCommand("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "corepack install"],
      windowsVerbatimArguments: true,
    });
    expect(buildCorepackInstallCommand("linux", {})).toEqual({ command: "corepack", args: ["install"] });
  });

  it.skipIf(process.platform === "win32")(
    "retries a transient Corepack install and succeeds on the third attempt",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-corepack-test-"));
      const bin = path.join(temporaryRoot, "bin");
      const counterFile = path.join(temporaryRoot, "attempts");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(temporaryRoot, "toolchain.json"), await repositoryFile("toolchain.json"));
      await writeRetryingCorepack(bin, counterFile, 2);

      try {
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "toolchain.mjs"), "corepack-install"], {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            BOARDREADYOPS_COREPACK_RETRY_DELAY_MS: "0",
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        });

        expect(result.status).toBe(0);
        expect(await readFile(counterFile, "utf8")).toBe("3\n");
        expect(result.stderr).toContain("Corepack install attempt 1/3 failed");
        expect(result.stderr).toContain("Corepack install attempt 2/3 failed");
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails closed after three unsuccessful Corepack install attempts",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-corepack-test-"));
      const bin = path.join(temporaryRoot, "bin");
      const counterFile = path.join(temporaryRoot, "attempts");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(temporaryRoot, "toolchain.json"), await repositoryFile("toolchain.json"));
      await writeRetryingCorepack(bin, counterFile, 3);

      try {
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "toolchain.mjs"), "corepack-install"], {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            BOARDREADYOPS_COREPACK_RETRY_DELAY_MS: "0",
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Corepack install failed after 3 attempts");
        expect(await readFile(counterFile, "utf8")).toBe("3\n");
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it("routes workflow Corepack installs through the tested toolchain boundary", async () => {
    const workflowDirectory = path.join(root, ".github", "workflows");
    const workflowFiles = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/u.test(file)).sort();
    const rawCorepackInstalls: string[] = [];

    for (const file of workflowFiles) {
      const content = await repositoryFile(path.join(".github", "workflows", file));
      if (/\bcorepack install\b/u.test(content)) rawCorepackInstalls.push(file);
    }

    expect(rawCorepackInstalls).toEqual([]);
  });

  it("routes automation installs through audited lifecycle-script allowlists", async () => {
    const packageJson = JSON.parse(await repositoryFile("package.json")) as { scripts: Record<string, string> };
    const ciInstall = packageJson.scripts["deps:install-ci"];
    const webInstall = packageJson.scripts["deps:install-web"];
    const trustedRebuild = "corepack pnpm rebuild @prisma/engines esbuild prisma sharp";

    expect(ciInstall).toBe(`corepack pnpm install --frozen-lockfile --ignore-scripts && ${trustedRebuild}`);
    expect(webInstall).toBe(
      `corepack pnpm install --frozen-lockfile --ignore-scripts --filter @boardreadyops/web... --filter boardreadyops && ${trustedRebuild}`,
    );

    const workflowDirectory = path.join(root, ".github", "workflows");
    const workflowFiles = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/u.test(file));
    for (const file of workflowFiles) {
      const content = await repositoryFile(path.join(".github", "workflows", file));
      const rawInstalls = content.split(/\r?\n/u).filter((line) => /\bpnpm install\b/u.test(line));
      expect(
        rawInstalls.every((line) => line.includes("--ignore-scripts")),
        file,
      ).toBe(true);
    }
    expect(await repositoryFile("apps/web/Dockerfile")).not.toMatch(/\bpnpm install\b/u);
    const containerDockerfile = await repositoryFile("apps/container/Dockerfile");
    expect(containerDockerfile).toContain("--global --ignore-scripts --no-audit --no-fund");
    expect(containerDockerfile).toContain(['"boardreadyops@$', '{BOARDREADYOPS_VERSION}"'].join(""));
  });

  it("resolves npm pack from the running Node installation instead of PATH", async () => {
    const checkNpmPack = await repositoryFile("scripts/check-npm-pack.mjs");

    expect(checkNpmPack).toContain(
      'const npmExecutable = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");',
    );
    expect(checkNpmPack).toContain('spawnSync(npmExecutable, ["pack", "--dry-run", "--json"]');
    expect(checkNpmPack).not.toContain('spawnSync("npm",');
  });

  it("routes nested package scripts through the repository-pinned Corepack pnpm", async () => {
    const packageJson = JSON.parse(await repositoryFile("package.json")) as { scripts: Record<string, string> };
    const barePnpmScripts = Object.entries(packageJson.scripts)
      .filter(([, script]) => /(^|[;&|]\s*)pnpm\b/.test(script.replaceAll("corepack pnpm", "")))
      .map(([name]) => name);

    expect(barePnpmScripts).toEqual([]);
  });

  it("prefers the pinned uv release for virtual-environment creation when available", async () => {
    const config = await manifest();
    const paths = resolveToolchainPaths("/repo", "/cache/boardreadyops");

    expect(buildVirtualEnvironmentCommand(config, paths, "python3.13", config.python.uv)).toEqual([
      "uv",
      "venv",
      "--python",
      "python3.13",
      "--seed",
      paths.venv,
    ]);
    expect(buildVirtualEnvironmentCommand(config, paths, "python3.13", "0.0.0")).toEqual([
      "python3.13",
      "-m",
      "venv",
      paths.venv,
    ]);
  });

  it("keeps bootstrap writes inside the repository toolchain directory", async () => {
    const config = await manifest();
    const paths = resolveToolchainPaths("/repo", "/cache/boardreadyops");
    const plan = buildBootstrapPlan(config, paths);

    expect(paths.root).toBe(path.join("/repo", ".boardreadyops", "toolchain"));
    expect(paths.cache).toBe(path.join("/cache/boardreadyops", "toolchain-v1"));
    expect(paths.browserRuntimeRoot).toBe(path.join("/cache/boardreadyops", "toolchain-v1", "browser-runtime", "root"));
    expect(plan.every((step) => step.cwd === "/repo" || step.cwd.startsWith(paths.root))).toBe(true);
    expect(plan.flatMap((step) => step.command).join(" ")).not.toMatch(/\bsudo\b|\/usr\/local|corepack enable/u);
    expect(
      plan.some((step) => step.command.join(" ").includes("pnpm install --frozen-lockfile --ignore-scripts")),
    ).toBe(true);
    const hooks = plan.find((step) => step.name === "Prepare pinned validation hooks");
    expect(hooks?.command.at(-1)).toBe("install-hooks");
    expect(hooks?.env).toMatchObject({ GOMAXPROCS: "2", GOFLAGS: "-p=2" });
    expect(plan.some((step) => step.command.includes(`uv==${config.python.uv}`))).toBe(true);
    expect(
      plan.some((step) => step.command.includes(`shellcheck-py==${config.validation.shellcheck.packageVersion}`)),
    ).toBe(true);
    expect(plan.some((step) => step.command.join(" ").includes("puppeteer browsers install chrome"))).toBe(true);
  });

  it("provides a secretless Prisma configuration default", () => {
    const paths = resolveToolchainPaths("/repo", "/cache/boardreadyops");
    const env = buildToolchainEnvironment(paths, { PATH: "/usr/bin" });

    expect(env.DATABASE_URL).toBe("postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_toolchain");
    expect(env.ALLOW_MAJOR_RELEASE).toBe("true");
    expect(env.LD_LIBRARY_PATH).toContain(paths.browserRuntimeLib);
    expect(env.PATH).toContain(`${paths.bin}${path.delimiter}`);

    const custom = buildToolchainEnvironment(paths, {
      ALLOW_MAJOR_RELEASE: "false",
      DATABASE_URL: "postgresql://custom",
      PATH: "/usr/bin",
    });
    expect(custom.DATABASE_URL).toBe("postgresql://custom");
    expect(custom.ALLOW_MAJOR_RELEASE).toBe("true");
  });

  it.skipIf(process.platform === "win32")("normalizes inherited setgid directory modes", async () => {
    const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-mode-test-"));
    const nested = path.join(temporaryRoot, "fixtures", "fab");
    await mkdir(nested, { recursive: true });

    try {
      const inheritedSetgid = (await stat(temporaryRoot)).mode & 0o2000;
      if (inheritedSetgid === 0) return;
      await expect(normalizeRepositoryModes(temporaryRoot)).resolves.toBeGreaterThanOrEqual(1);
      expect((await stat(temporaryRoot)).mode & 0o2000).toBe(0);
      expect((await stat(nested)).mode & 0o2000).toBe(0);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("passes a complete compatible toolchain", async () => {
    const result = evaluateToolchain(await manifest(), healthyProbe());

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("rejects a present browser binary that cannot launch", async () => {
    const result = evaluateToolchain(await manifest(), healthyProbe({ browserVersion: undefined }));
    const browser = result.checks.find((check) => check.id === "browser");

    expect(result.ok).toBe(false);
    expect(browser).toMatchObject({
      status: "fail",
      message: expect.stringContaining("cannot start"),
      remediation: expect.stringContaining("bootstrap"),
    });
  });

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "rejects an unusable explicit Python before JavaScript dependency installation",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-python-test-"));
      const bin = path.join(temporaryRoot, "bin");
      const fakePython = path.join(bin, "broken-python");
      const corepackMarker = path.join(temporaryRoot, "corepack-called");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(temporaryRoot, "toolchain.json"), await repositoryFile("toolchain.json"));
      await writeFakePython(fakePython, { subprocess: "missing" });
      await writeFailingCorepack(bin, corepackMarker);

      try {
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "toolchain.mjs"), "bootstrap"], {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            BOARDREADYOPS_PYTHON: fakePython,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("subprocess");
        expect(result.stderr).toContain("BOARDREADYOPS_PYTHON");
        await expect(stat(corepackMarker)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "rejects an explicit Python without virtual-environment support before dependency installation",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-python-test-"));
      const bin = path.join(temporaryRoot, "bin");
      const fakePython = path.join(bin, "no-venv-python");
      const corepackMarker = path.join(temporaryRoot, "corepack-called");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(temporaryRoot, "toolchain.json"), await repositoryFile("toolchain.json"));
      await writeFakePython(fakePython, { venv: "missing" });
      await writeFailingCorepack(bin, corepackMarker);

      try {
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "toolchain.mjs"), "bootstrap"], {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            BOARDREADYOPS_PYTHON: fakePython,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("virtual-environment");
        await expect(stat(corepackMarker)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "rejects an explicit Python whose virtual environment has no package installer",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-python-test-"));
      const bin = path.join(temporaryRoot, "bin");
      const fakePython = path.join(bin, "no-pip-python");
      const corepackMarker = path.join(temporaryRoot, "corepack-called");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(temporaryRoot, "toolchain.json"), await repositoryFile("toolchain.json"));
      await writeFakePython(fakePython, { pip: "missing" });
      await writeFailingCorepack(bin, corepackMarker);

      try {
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "toolchain.mjs"), "bootstrap"], {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            BOARDREADYOPS_PYTHON: fakePython,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("package installer");
        expect(result.stderr).toContain("pip");
        await expect(stat(corepackMarker)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "falls back deterministically after explaining why a preferred Python candidate was rejected",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(root, ".toolchain-python-test-"));
      const bin = path.join(temporaryRoot, "bin");
      const corepackMarker = path.join(temporaryRoot, "corepack-called");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(temporaryRoot, "toolchain.json"), await repositoryFile("toolchain.json"));
      await writeFakePython(path.join(bin, "python3.13"), { venv: "missing" });
      await writeFakePython(path.join(bin, "python3"), { version: "3.12.3" });
      await writeFailingCorepack(bin, corepackMarker);

      try {
        const result = spawnSync(process.execPath, [path.join(root, "scripts", "toolchain.mjs"), "bootstrap"], {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            BOARDREADYOPS_PYTHON: "",
            PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
          },
          encoding: "utf8",
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Python candidate python3.13: rejected");
        expect(result.stdout).toContain("virtual-environment");
        expect(result.stdout).toContain("Python candidate python3: selected (Python 3.12.3)");
        await expect(stat(corepackMarker)).resolves.toBeDefined();
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it("fails early with actionable missing prerequisite messages", async () => {
    const result = evaluateToolchain(
      await manifest(),
      healthyProbe({
        corepackVersion: undefined,
        pnpmVersion: undefined,
        pythonVersion: "3.10.14",
        shellcheckVersion: undefined,
        uvVersion: undefined,
        hooksReady: false,
        browserPath: undefined,
        browserExecutable: false,
        browserVersion: undefined,
        packageDependenciesInstalled: false,
        repositoryModesNormalized: false,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repository-modes",
          status: "fail",
          remediation: expect.stringContaining("bootstrap"),
        }),
        expect.objectContaining({ id: "corepack", status: "fail", remediation: expect.stringContaining("Corepack") }),
        expect.objectContaining({ id: "pnpm", status: "fail", remediation: expect.stringContaining("bootstrap") }),
        expect.objectContaining({ id: "python", status: "fail", remediation: expect.stringContaining("3.11") }),
        expect.objectContaining({
          id: "shellcheck",
          status: "fail",
          remediation: expect.stringContaining("bootstrap"),
        }),
        expect.objectContaining({ id: "uv", status: "fail", remediation: expect.stringContaining("bootstrap") }),
        expect.objectContaining({ id: "hooks", status: "fail", remediation: expect.stringContaining("bootstrap") }),
        expect.objectContaining({ id: "browser", status: "fail", remediation: expect.stringContaining("bootstrap") }),
      ]),
    );
  });
});
