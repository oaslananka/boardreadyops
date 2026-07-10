import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageVersion = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")).version;

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
  canaryHealthUrl: "http://127.0.0.1:3004/api/health",
  imageRepository: "boardreadyops-web-runtime",
  runtimeEnvFile: "/opt/boardreadyops-cloud/runtime-env",
  artifactVolume: "boardreadyops_artifacts",
  network: "boardreadyops-cloud",
  livePublish: "127.0.0.1:3003:3000",
  canaryPublish: "127.0.0.1:3004:3000",
  revision: "",
  skipInstall: false,
  dryRun: false,
  healthAttempts: 60,
  healthDelayMs: 1000,
};

function envFlag(env, name) {
  return ["1", "true", "yes"].includes(String(env[name] ?? "").toLowerCase());
}

function envValue(env, name, fallback) {
  return env[name] ?? fallback;
}

function envInteger(env, name, fallback) {
  const value = Number.parseInt(String(env[name] ?? ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readDeployOptions(env = process.env) {
  return {
    appName: envValue(env, "BOARDREADYOPS_CLOUD_APP_NAME", defaultDeployOptions.appName),
    container: envValue(env, "BOARDREADYOPS_CLOUD_CONTAINER", defaultDeployOptions.container),
    healthUrl: envValue(env, "BOARDREADYOPS_CLOUD_HEALTH_URL", defaultDeployOptions.healthUrl),
    canaryHealthUrl: envValue(env, "BOARDREADYOPS_CLOUD_CANARY_HEALTH_URL", defaultDeployOptions.canaryHealthUrl),
    imageRepository: envValue(env, "BOARDREADYOPS_CLOUD_IMAGE_REPOSITORY", defaultDeployOptions.imageRepository),
    runtimeEnvFile: envValue(env, "BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE", defaultDeployOptions.runtimeEnvFile),
    artifactVolume: envValue(env, "BOARDREADYOPS_CLOUD_ARTIFACT_VOLUME", defaultDeployOptions.artifactVolume),
    network: envValue(env, "BOARDREADYOPS_CLOUD_NETWORK", defaultDeployOptions.network),
    livePublish: envValue(env, "BOARDREADYOPS_CLOUD_LIVE_PUBLISH", defaultDeployOptions.livePublish),
    canaryPublish: envValue(env, "BOARDREADYOPS_CLOUD_CANARY_PUBLISH", defaultDeployOptions.canaryPublish),
    revision: envValue(env, "BOARDREADYOPS_CLOUD_REVISION", defaultDeployOptions.revision),
    skipInstall: envFlag(env, "BOARDREADYOPS_CLOUD_SKIP_INSTALL"),
    dryRun: envFlag(env, "BOARDREADYOPS_CLOUD_DRY_RUN"),
    healthAttempts: envInteger(env, "BOARDREADYOPS_CLOUD_HEALTH_ATTEMPTS", defaultDeployOptions.healthAttempts),
    healthDelayMs: envInteger(env, "BOARDREADYOPS_CLOUD_HEALTH_DELAY_MS", defaultDeployOptions.healthDelayMs),
  };
}

export function dockerTagFromRevision(revision) {
  const normalized = revision.replaceAll(/[^A-Za-z0-9_.-]/g, "-").replaceAll(/^-+|-+$/g, "");
  return (normalized || "unknown").slice(0, 128);
}

function render(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options, { capture = false, allowFailure = false, quiet = false } = {}) {
  const rendered = render(command, args);
  log(`$ ${rendered}`);

  if (options.dryRun) {
    return "";
  }

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: capture || quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0 && !allowFailure) {
    const details = String(result.stderr ?? "").trim();
    if (details) {
      logError(details);
    }
    throw new Error(`${rendered} failed with exit code ${result.status ?? "unknown"}`);
  }

  return capture ? String(result.stdout ?? "").trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpHealth(url, options) {
  let lastError;

  for (let attempt = 1; attempt <= options.healthAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const body = await response.json();

      if (response.ok && body?.ok === true) {
        log(`Health check passed: ${url}`);
        return;
      }

      lastError = new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < options.healthAttempts) {
      await sleep(options.healthDelayMs);
    }
  }

  throw new Error(
    `Health check failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function waitForContainerHealth(container, options) {
  if (options.dryRun) {
    return;
  }

  for (let attempt = 1; attempt <= options.healthAttempts; attempt += 1) {
    const stateJson = run("docker", ["inspect", "--format", "{{json .State}}", container], options, {
      capture: true,
    });
    const state = JSON.parse(stateJson);
    const health = state.Health?.Status;

    if (health === "healthy") {
      log(`Container health passed: ${container}`);
      return;
    }

    if (health === "unhealthy" || state.Status === "exited" || state.Status === "dead") {
      throw new Error(`${container} entered state status=${state.Status} health=${health ?? "missing"}`);
    }

    if (attempt < options.healthAttempts) {
      await sleep(options.healthDelayMs);
    }
  }

  throw new Error(`${container} did not become healthy before the deployment timeout`);
}

export function runtimeContainerArgs({ name, image, publish, networkAlias, restart, revision, options }) {
  return [
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    restart,
    "--network",
    options.network,
    "--network-alias",
    networkAlias,
    "--mount",
    `type=bind,src=${options.runtimeEnvFile},dst=/run/app-env,readonly`,
    "--mount",
    `type=volume,src=${options.artifactVolume},dst=/data/artifacts`,
    "-p",
    publish,
    "--label",
    `com.boardreadyops.deployment.revision=${revision}`,
    image,
  ];
}

export async function deployCloud(options = readDeployOptions()) {
  const revision =
    options.revision || (options.dryRun ? "dry-run" : run("git", ["rev-parse", "HEAD"], options, { capture: true }));
  const revisionTag = dockerTagFromRevision(revision);
  const shortRevision = revisionTag.slice(0, 12);
  const buildDate = new Date().toISOString();
  const stamp = buildDate.replaceAll(/[:.]/g, "-");
  const image = `${options.imageRepository}:${revisionTag}`;
  const latestImage = `${options.imageRepository}:latest`;
  const rollbackImage = `${options.imageRepository}:rollback-${stamp}`;
  const canaryContainer = `${options.container}-canary-${shortRevision}`;
  const previousContainer = `${options.container}-previous-${stamp}`;

  if (!options.skipInstall) {
    run("pnpm", ["install", "--frozen-lockfile"], options);
  }

  run("docker", ["volume", "create", options.artifactVolume], options);
  run(
    "docker",
    [
      "build",
      "--file",
      "apps/web/Dockerfile",
      "--build-arg",
      `BUILD_DATE=${buildDate}`,
      "--build-arg",
      `VCS_REF=${revision}`,
      "--build-arg",
      `VERSION=${packageVersion}`,
      "--tag",
      image,
      "--tag",
      latestImage,
      ".",
    ],
    options,
  );

  run("docker", ["rm", "-f", canaryContainer], options, { allowFailure: true, quiet: true });

  try {
    run(
      "docker",
      runtimeContainerArgs({
        name: canaryContainer,
        image,
        publish: options.canaryPublish,
        networkAlias: "web-canary",
        restart: "no",
        revision,
        options,
      }),
      options,
    );
    await waitForContainerHealth(canaryContainer, options);
    if (!options.dryRun) {
      await waitForHttpHealth(options.canaryHealthUrl, options);
    }
  } finally {
    run("docker", ["rm", "-f", canaryContainer], options, { allowFailure: true, quiet: true });
  }

  const currentImageId = options.dryRun
    ? "current-image-id"
    : run("docker", ["inspect", "--format", "{{.Image}}", options.container], options, { capture: true });

  run("docker", ["image", "tag", currentImageId, rollbackImage], options);
  run("docker", ["rename", options.container, previousContainer], options);
  run("docker", ["update", "--restart=no", previousContainer], options);
  run("docker", ["stop", "--timeout", "20", previousContainer], options);

  try {
    run(
      "docker",
      runtimeContainerArgs({
        name: options.container,
        image,
        publish: options.livePublish,
        networkAlias: "web",
        restart: "unless-stopped",
        revision,
        options,
      }),
      options,
    );
    await waitForContainerHealth(options.container, options);
    if (!options.dryRun) {
      await waitForHttpHealth(options.healthUrl, options);
    }
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    logError(`Deployment failed; restoring ${previousContainer}.`);
    run("docker", ["rm", "-f", options.container], options, { allowFailure: true, quiet: true });
    run("docker", ["rename", previousContainer, options.container], options);
    run("docker", ["update", "--restart=unless-stopped", options.container], options);
    run("docker", ["start", options.container], options);
    if (!options.dryRun) {
      await waitForHttpHealth(options.healthUrl, options);
    }
    throw error;
  }

  run("docker", ["rm", previousContainer], options);
  log(`${options.appName} deployment completed successfully at revision ${revision}.`);
  log(`Rollback image retained as ${rollbackImage}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployCloud().catch((error) => {
    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
