import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredEnvironmentValue as requiredEnv } from "./lib/environment.mjs";

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
  workerContainer: "bro-worker",
  healthUrl: "",
  canaryHealthUrl: "http://127.0.0.1:3004/api/health",
  imageRepository: "boardreadyops-web-runtime",
  runtimeEnvFile: "/opt/boardreadyops-cloud/runtime-env",
  runnerResultKeyFile: "",
  artifactSigningKeyFile: "",
  releaseRepositoriesFile: "",
  requireGithubOidc: false,
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
    workerContainer: envValue(env, "BOARDREADYOPS_CLOUD_WORKER_CONTAINER", defaultDeployOptions.workerContainer),
    healthUrl: requiredEnv(env, "BOARDREADYOPS_CLOUD_HEALTH_URL"),
    canaryHealthUrl: envValue(env, "BOARDREADYOPS_CLOUD_CANARY_HEALTH_URL", defaultDeployOptions.canaryHealthUrl),
    imageRepository: envValue(env, "BOARDREADYOPS_CLOUD_IMAGE_REPOSITORY", defaultDeployOptions.imageRepository),
    runtimeEnvFile: envValue(env, "BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE", defaultDeployOptions.runtimeEnvFile),
    runnerResultKeyFile: envValue(
      env,
      "BOARDREADYOPS_CLOUD_RUNNER_RESULT_KEY_FILE",
      defaultDeployOptions.runnerResultKeyFile,
    ),
    artifactSigningKeyFile: envValue(
      env,
      "BOARDREADYOPS_CLOUD_ARTIFACT_SIGNING_KEY_FILE",
      defaultDeployOptions.artifactSigningKeyFile,
    ),
    releaseRepositoriesFile: envValue(
      env,
      "BOARDREADYOPS_CLOUD_RELEASE_REPOSITORIES_FILE",
      defaultDeployOptions.releaseRepositoriesFile,
    ),
    requireGithubOidc: envFlag(env, "BOARDREADYOPS_CLOUD_REQUIRE_GITHUB_OIDC"),
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
  const cleaned = revision.replace(/[^A-Za-z0-9_.-]/g, "-");
  let start = 0;
  let end = cleaned.length;
  while (start < end && cleaned[start] === "-") {
    start += 1;
  }
  while (end > start && cleaned[end - 1] === "-") {
    end -= 1;
  }
  const normalized = cleaned.slice(start, end);
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

function appendReleaseRepositoriesArgs(args, options) {
  if (!options.releaseRepositoriesFile) return;
  args.push(
    "--mount",
    `type=bind,src=${options.releaseRepositoriesFile},dst=/run/policies/repositories,readonly`,
    "--env",
    "BOARDREADYOPS_RELEASE_REPOSITORIES_FILE=/run/policies/repositories",
  );
}

function daemonContainerArgs(name, restart, network) {
  return ["run", "-d", "--name", name, "--restart", restart, "--network", network];
}

export function runtimeContainerArgs({ name, image, publish, networkAlias, restart, revision, options }) {
  const args = daemonContainerArgs(name, restart, options.network);
  args.push(
    "--network-alias",
    networkAlias,
    "--mount",
    `type=bind,src=${options.runtimeEnvFile},dst=/run/app-env,readonly`,
  );

  if (options.runnerResultKeyFile) {
    args.push(
      "--mount",
      `type=bind,src=${options.runnerResultKeyFile},dst=/run/keys/a,readonly`,
      "--env",
      "BOARDREADYOPS_RUNNER_RESULT_KEY_FILE=/run/keys/a",
      "--env",
      "BOARDREADYOPS_REQUIRE_" + "RUNNER_SIGNATURE=1",
    );
  }

  if (options.artifactSigningKeyFile) {
    args.push(
      "--mount",
      `type=bind,src=${options.artifactSigningKeyFile},dst=/run/keys/b,readonly`,
      "--env",
      "ARTIFACT_DOWNLOAD_SIGNING_KEY_FILE=/run/keys/b",
    );
  }

  appendReleaseRepositoriesArgs(args, options);

  if (options.requireGithubOidc) {
    args.push("--env", "BOARDREADYOPS_REQUIRE_GITHUB_OIDC=1");
  }

  args.push(
    "--mount",
    `type=volume,src=${options.artifactVolume},dst=/data/artifacts`,
    "-p",
    publish,
    "--label",
    `com.boardreadyops.deployment.revision=${revision}`,
    image,
  );
  return args;
}

function containerExists(name, options) {
  if (options.dryRun) return true;
  return Boolean(
    run("docker", ["inspect", "--format", "{{.Id}}", name], options, {
      capture: true,
      allowFailure: true,
      quiet: true,
    }),
  );
}

export function migrationContainerArgs({ image, options }) {
  return [
    "run",
    "--rm",
    "--network",
    options.network,
    "--mount",
    `type=bind,src=${options.runtimeEnvFile},dst=/run/app-env,readonly`,
    image,
    "node",
    "migrate.mjs",
  ];
}

export function workerContainerArgs({ name, image, restart, revision, options }) {
  const args = daemonContainerArgs(name, restart, options.network);
  args.push(
    "--network-alias",
    "worker",
    "--mount",
    `type=bind,src=${options.runtimeEnvFile},dst=/run/app-env,readonly`,
  );

  appendReleaseRepositoriesArgs(args, options);

  args.push(
    "--env",
    "BOARDREADYOPS_WORKER_HEALTH_PORT=3001",
    "--health-cmd",
    `node -e "fetch('http://127.0.0.1:3001/health/ready',{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok||b?.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"`,
    "--health-interval",
    "15s",
    "--health-timeout",
    "5s",
    "--health-start-period",
    "20s",
    "--health-retries",
    "4",
    "--label",
    `com.boardreadyops.deployment.revision=${revision}`,
    image,
    "node",
    "worker.mjs",
  );
  return args;
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
  const previousWorkerContainer = `${options.workerContainer}-previous-${stamp}`;

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

  run("docker", migrationContainerArgs({ image, options }), options);

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

  const hadPreviousWorker = containerExists(options.workerContainer, options);

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

    if (hadPreviousWorker) {
      run("docker", ["rename", options.workerContainer, previousWorkerContainer], options);
      run("docker", ["update", "--restart=no", previousWorkerContainer], options);
      run("docker", ["stop", "--timeout", "30", previousWorkerContainer], options);
    }
    run(
      "docker",
      workerContainerArgs({
        name: options.workerContainer,
        image,
        restart: "unless-stopped",
        revision,
        options,
      }),
      options,
    );
    await waitForContainerHealth(options.workerContainer, options);
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    logError(`Deployment failed; restoring ${previousContainer}.`);
    run("docker", ["rm", "-f", options.workerContainer], options, { allowFailure: true, quiet: true });
    if (hadPreviousWorker) {
      run("docker", ["rename", previousWorkerContainer, options.workerContainer], options);
      run("docker", ["update", "--restart=unless-stopped", options.workerContainer], options);
      run("docker", ["start", options.workerContainer], options);
    }
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
  if (hadPreviousWorker) {
    run("docker", ["rm", previousWorkerContainer], options);
  }
  log(`${options.appName} deployment completed successfully at revision ${revision}.`);
  log(`Rollback image retained as ${rollbackImage}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployCloud().catch((error) => {
    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
