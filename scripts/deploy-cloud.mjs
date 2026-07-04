import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function log(message) {
  process.stdout.write(`${message}\n`);
}

function logError(message) {
  process.stderr.write(`${message}\n`);
}

export const defaultDeployOptions = {
  appName: "boardreadyops-cloud",
  container: "bro-web",
  healthUrl: "https://boardreadyops.oaslananka.dev/api/health",
  backupRoot: "/opt/boardreadyops-cloud/backups",
  skipInstall: false,
  dryRun: false,
};

function envFlag(name) {
  return ["1", "true", "yes"].includes(String(process.env[name] ?? "").toLowerCase());
}

function optionValue(name, fallback) {
  return process.env[name] ?? fallback;
}

export function readDeployOptions() {
  return {
    appName: optionValue("BOARDREADYOPS_CLOUD_APP_NAME", defaultDeployOptions.appName),
    container: optionValue("BOARDREADYOPS_CLOUD_CONTAINER", defaultDeployOptions.container),
    healthUrl: optionValue("BOARDREADYOPS_CLOUD_HEALTH_URL", defaultDeployOptions.healthUrl),
    backupRoot: optionValue("BOARDREADYOPS_CLOUD_BACKUP_ROOT", defaultDeployOptions.backupRoot),
    skipInstall: envFlag("BOARDREADYOPS_CLOUD_SKIP_INSTALL"),
    dryRun: envFlag("BOARDREADYOPS_CLOUD_DRY_RUN"),
  };
}

function run(command, args, options) {
  const rendered = [command, ...args].join(" ");
  log(`$ ${rendered}`);

  if (options.dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${rendered} failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function healthCheck(url, options) {
  log(`Checking ${url}`);

  if (options.dryRun) {
    return;
  }

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }

  const body = await response.json();

  if (body?.ok !== true) {
    throw new Error(`Health check returned an unexpected body: ${JSON.stringify(body)}`);
  }
}

export async function deployCloud(options = readDeployOptions()) {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const backupDir = join(options.backupRoot, stamp);
  const nextDir = "apps/web/.next";
  const containerNextDir = `/app/${nextDir}`;

  if (!options.skipInstall) {
    run("pnpm", ["install", "--frozen-lockfile"], options);
  }

  run("pnpm", ["--filter", "@boardreadyops/web", "build"], options);
  log(`Backing up ${options.container}:${containerNextDir} to ${backupDir}`);

  if (!options.dryRun) {
    await rm(backupDir, { force: true, recursive: true });
    await mkdir(backupDir, { recursive: true });
  }

  run("docker", ["cp", `${options.container}:${containerNextDir}`, join(backupDir, ".next")], options);

  try {
    run("docker", ["cp", join(rootDir, nextDir), `${options.container}:${containerNextDir}`], options);
    run("docker", ["container", "restart", options.container], options);
    await healthCheck(options.healthUrl, options);
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    logError("Deployment failed; restoring previous .next output.");
    run("docker", ["cp", join(backupDir, ".next"), `${options.container}:${containerNextDir}`], options);
    run("docker", ["container", "restart", options.container], options);
    await healthCheck(options.healthUrl, options);
    throw error;
  }

  log(`${options.appName} deployment completed successfully.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployCloud().catch((error) => {
    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
