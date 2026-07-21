import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const COVERAGE_TEST_PATHS = ["tests/unit", "tests/action", "tests/property", "tests/snapshot"];

export function buildCodecovCoverageArguments({ githubActions = process.env.GITHUB_ACTIONS === "true" } = {}) {
  const reporters = ["--reporter=default"];
  if (githubActions) {
    reporters.push("--reporter=github-actions");
  }
  reporters.push("--reporter=junit");

  return [
    "run",
    "--coverage",
    ...reporters,
    "--outputFile.junit=coverage/test-results.junit.xml",
    ...COVERAGE_TEST_PATHS,
  ];
}

export function runCodecovCoverage({ env = process.env, stdio = "inherit" } = {}) {
  const pnpmCli = env.npm_execpath;
  if (!pnpmCli) {
    throw new Error("npm_execpath is required to run the pinned pnpm CLI");
  }

  const result = spawnSync(
    process.execPath,
    [pnpmCli, "exec", "vitest", ...buildCodecovCoverageArguments({ githubActions: env.GITHUB_ACTIONS === "true" })],
    { env, stdio },
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runCodecovCoverage();
}
