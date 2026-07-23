import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function buildCloudCoverageArguments({ githubActions = process.env.GITHUB_ACTIONS === "true" } = {}) {
  const reporters = ["--reporter=default"];
  if (githubActions) reporters.push("--reporter=github-actions");
  reporters.push("--reporter=junit");
  return [
    "run",
    "--config",
    "vitest.cloud.config.ts",
    "--coverage",
    ...reporters,
    "--outputFile.junit=coverage/cloud/test-results.junit.xml",
  ];
}

export function runCloudCoverage({ env = process.env, stdio = "inherit" } = {}) {
  const pnpmCli = env.npm_execpath;
  if (!pnpmCli) throw new Error("npm_execpath is required to run the pinned pnpm CLI");
  const result = spawnSync(
    process.execPath,
    [pnpmCli, "exec", "vitest", ...buildCloudCoverageArguments({ githubActions: env.GITHUB_ACTIONS === "true" })],
    { env, stdio },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runCloudCoverage();
}
