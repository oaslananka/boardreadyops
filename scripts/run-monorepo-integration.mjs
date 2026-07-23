#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getPostgresTestConnectionString, TOOLCHAIN_DATABASE_URL } from "./postgres-test-contract.mjs";

export { TOOLCHAIN_DATABASE_URL };

export const REQUIRED_INTEGRATION_TESTS = [
  "tests/integration/build-concurrency.test.ts",
  "tests/integration/cli.test.ts",
  "tests/integration/cross-platform-paths.test.ts",
  "tests/integration/e2e.test.ts",
  "tests/integration/fabrication-diff.test.ts",
  "tests/integration/fix-command.test.ts",
  "tests/integration/fixtures.test.ts",
  "tests/integration/plugin-sdk-contract.test.ts",
];

export const POSTGRES_INTEGRATION_TESTS = [
  "tests/integration/control-plane-job-store-postgres.test.ts",
  "tests/integration/control-plane-operations-postgres.test.ts",
  "tests/integration/control-plane-outbox-postgres.test.ts",
  "tests/integration/runner-artifact-store-postgres.test.ts",
  "tests/integration/runner-lease-store-postgres.test.ts",
  "tests/integration/runner-registration-enrollment-postgres.test.ts",
  "tests/integration/runner-result-postgres.test.ts",
  "tests/integration/runner-routing-policy-postgres.test.ts",
  "tests/integration/runner-terminal-result-authorizer-postgres.test.ts",
  "tests/integration/transactional-release-run-outbox-postgres.test.ts",
];

function status(status, detail) {
  return detail ? { status, detail } : { status };
}

export function buildMonorepoIntegrationPlan({ environment = process.env, kicadAvailable = false } = {}) {
  const databaseUrl = getPostgresTestConnectionString(environment);
  return {
    requiredTests: [...REQUIRED_INTEGRATION_TESTS],
    postgresTests: databaseUrl ? [...POSTGRES_INTEGRATION_TESTS] : [],
    databaseUrl,
    required: status("tested", `${REQUIRED_INTEGRATION_TESTS.length} files`),
    postgres: databaseUrl
      ? status("tested", `${POSTGRES_INTEGRATION_TESTS.length} files`)
      : status("environment-dependent"),
    kicad: kicadAvailable
      ? status("tested", "supported kicad-cli available")
      : status("skipped", "environment-dependent: requires a supported kicad-cli"),
  };
}

export function isSupportedKicadVersion(version) {
  return /^(9|10)\./u.test(version.trim());
}

function supportedKicadAvailable() {
  const result = spawnSync("kicad-cli", ["version"], { encoding: "utf8" });
  return !result.error && result.status === 0 && isSupportedKicadVersion(result.stdout ?? "");
}

function runPinnedPnpm(args, { environment = process.env } = {}) {
  const pnpmCli = environment.npm_execpath;
  if (!pnpmCli) throw new Error("npm_execpath is required to run the pinned pnpm CLI");
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status ?? 1;
}

function vitestArguments(outputFile, files) {
  return [
    "exec",
    "vitest",
    "run",
    "--no-file-parallelism",
    "--reporter=default",
    "--reporter=junit",
    `--outputFile.junit=${outputFile}`,
    ...files,
  ];
}

export function runMonorepoIntegration({ environment = process.env } = {}) {
  const kicadAvailable = supportedKicadAvailable();
  if (environment.BOARDREADYOPS_KICAD_TESTS === "true" && !kicadAvailable) {
    throw new Error("BOARDREADYOPS_KICAD_TESTS=true requires kicad-cli on PATH");
  }

  const plan = buildMonorepoIntegrationPlan({ environment, kicadAvailable });
  fs.mkdirSync("coverage/integration", { recursive: true });
  fs.mkdirSync(".boardreadyops/verification", { recursive: true });

  if (
    runPinnedPnpm(vitestArguments("coverage/integration/test-results.junit.xml", plan.requiredTests), { environment })
  ) {
    return 1;
  }

  if (plan.databaseUrl) {
    if (runPinnedPnpm(["--filter", "@boardreadyops/db", "db:migrate"], { environment })) return 1;
    if (
      runPinnedPnpm(vitestArguments("coverage/integration/postgres-results.junit.xml", plan.postgresTests), {
        environment,
      })
    ) {
      return 1;
    }
  }

  fs.writeFileSync(
    ".boardreadyops/verification/integration-summary.json",
    `${JSON.stringify({ required: plan.required, postgres: plan.postgres, kicad: plan.kicad }, null, 2)}\n`,
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = runMonorepoIntegration();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
