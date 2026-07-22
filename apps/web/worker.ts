import { createServer } from "node:http";
import { hostname } from "node:os";
import { type ClaimedControlPlaneJob, createSqlControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import { createSqlControlPlaneOperationsStore } from "@boardreadyops/db/control-plane-operations-store";
import {
  type ClaimedControlPlaneOutboxEffect,
  createSqlControlPlaneOutboxStore,
} from "@boardreadyops/db/control-plane-outbox-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlTransactionalGitHubAppLifecycleStore } from "@boardreadyops/db/transactional-lifecycle-store";
import { processControlPlaneOutboxEffect } from "./lib/control-plane-outbox-worker.js";
import { processControlPlaneJob } from "./lib/control-plane-worker.js";
import {
  createScopedConcurrencyGate,
  jobCorrelation,
  outboxCorrelation,
  sanitizeWorkerLogFields,
  workerScopeFromJob,
  workerScopeFromOutboxEffect,
} from "./lib/control-plane-worker-runtime.js";
import { createGitHubAppCheckRunClient } from "./lib/github-app-check-run-client.js";
import { createRunnerClient } from "./lib/runner-client.js";
import { runnerModeSummary, runnerWorkflowDispatchClient } from "./lib/runner-mode.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the control-plane worker");

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function log(level: "error" | "info" | "warn", event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component: "control-plane-worker",
      event,
      ...sanitizeWorkerLogFields(fields),
    })}\n`,
  );
}

const workerId = (process.env.BOARDREADYOPS_WORKER_ID?.trim() || `${hostname()}-${process.pid}`).slice(0, 128);
const concurrency = integerEnvironment("BOARDREADYOPS_WORKER_CONCURRENCY", 4, 1, 32);
const outboxConcurrency = integerEnvironment("BOARDREADYOPS_OUTBOX_CONCURRENCY", 4, 1, 32);
const installationConcurrency = integerEnvironment("BOARDREADYOPS_WORKER_INSTALLATION_CONCURRENCY", 4, 1, 32);
const repositoryConcurrency = integerEnvironment("BOARDREADYOPS_WORKER_REPOSITORY_CONCURRENCY", 2, 1, 32);
const pollMilliseconds = integerEnvironment("BOARDREADYOPS_WORKER_POLL_MS", 1000, 100, 60_000);
const outboxPollMilliseconds = integerEnvironment("BOARDREADYOPS_OUTBOX_POLL_MS", 500, 100, 60_000);
const metricsIntervalMilliseconds = integerEnvironment(
  "BOARDREADYOPS_WORKER_METRICS_INTERVAL_MS",
  30_000,
  1_000,
  3_600_000,
);
const retentionCleanupIntervalMilliseconds = integerEnvironment(
  "BOARDREADYOPS_WORKER_RETENTION_CLEANUP_INTERVAL_MS",
  3_600_000,
  60_000,
  86_400_000,
);
const healthPort = integerEnvironment("BOARDREADYOPS_WORKER_HEALTH_PORT", 3001, 1, 65_535);
const databasePoolMaximum = integerEnvironment(
  "DATABASE_POOL_MAX",
  Math.max(8, concurrency + outboxConcurrency + 2),
  1,
  100,
);
const executor = createPgQueryExecutor({ connectionString: databaseUrl, max: databasePoolMaximum });
const jobs = createSqlControlPlaneJobStore(executor);
const operations = createSqlControlPlaneOperationsStore(executor);
const outbox = createSqlControlPlaneOutboxStore(executor);
const lifecycle = createSqlTransactionalGitHubAppLifecycleStore(executor);
const scopedConcurrency = createScopedConcurrencyGate({
  installationLimit: installationConcurrency,
  repositoryLimit: repositoryConcurrency,
});
const runner = runnerModeSummary();
const checkRuns = createGitHubAppCheckRunClient();
const durableCheckRuns = checkRuns?.ensurePullRequestCheckRun
  ? {
      ensurePullRequestCheckRun: checkRuns.ensurePullRequestCheckRun,
      completeCheckRun: checkRuns.completeCheckRun,
    }
  : undefined;
const workflowDispatch = runnerWorkflowDispatchClient(runner, createRunnerClient);
const dispatchMode = runner.mode === "github-actions" ? "github-actions" : "none";
const lifecycleConfigurationValid = runner.configurationValid;
const outboxConfigurationValid =
  runner.configurationValid &&
  runner.mode !== "disabled" &&
  Boolean(durableCheckRuns) &&
  (runner.mode !== "github-actions" || Boolean(workflowDispatch));
const controlPlaneConfigurationValid =
  lifecycleConfigurationValid && (runner.mode === "disabled" || outboxConfigurationValid);
let shuttingDown = false;
let ready = false;
let lastPollAt: string | undefined;
let lastOutboxPollAt: string | undefined;
let lastSuccessfulJobAt: string | undefined;
let lastSuccessfulOutboxEffectAt: string | undefined;
let nextMetricsAt = 0;
let nextRetentionCleanupAt = 0;

async function databaseIsReady(): Promise<boolean> {
  try {
    await executor.query("select 1 as ready");
    return true;
  } catch {
    return false;
  }
}

const healthServer = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.url === "/health/live") {
    response.statusCode = 200;
    response.end(JSON.stringify({ ok: true, service: "control-plane-worker" }));
    return;
  }
  if (request.url === "/health/ready") {
    const databaseReady = await databaseIsReady();
    const ok = ready && !shuttingDown && databaseReady && controlPlaneConfigurationValid;
    response.statusCode = ok ? 200 : 503;
    response.end(
      JSON.stringify({
        ok,
        service: "control-plane-worker",
        databaseReady,
        runnerConfigurationValid: controlPlaneConfigurationValid,
        lifecycleConfigurationValid,
        outboxConfigurationValid,
        lastPollAt,
        lastOutboxPollAt,
        lastSuccessfulJobAt,
        lastSuccessfulOutboxEffectAt,
        scopedConcurrency: {
          installationLimit: installationConcurrency,
          repositoryLimit: repositoryConcurrency,
          ...scopedConcurrency.snapshot(),
        },
      }),
    );
    return;
  }
  if (request.url === "/version") {
    response.statusCode = 200;
    response.end(
      JSON.stringify({
        version: process.env.BOARDREADYOPS_VERSION ?? "dev",
        revision: process.env.BOARDREADYOPS_GIT_SHA ?? "unknown",
      }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false, error: "not found" }));
});

async function startHealthServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    healthServer.once("error", handleError);
    healthServer.listen(healthPort, "0.0.0.0", () => {
      healthServer.off("error", handleError);
      resolve();
    });
  });
  ready = true;
  log("info", "worker.started", {
    workerId,
    concurrency,
    outboxConcurrency,
    installationConcurrency,
    repositoryConcurrency,
    healthPort,
    runnerMode: runner.mode,
    configurationValid: controlPlaneConfigurationValid,
    lifecycleConfigurationValid,
    outboxConfigurationValid,
  });
}

async function collectQueueMetrics(currentTime: number): Promise<void> {
  if (currentTime < nextMetricsAt) return;
  nextMetricsAt = currentTime + metricsIntervalMilliseconds;
  try {
    const [jobMetrics, outboxMetrics] = await Promise.all([jobs.collectMetrics(), outbox.collectMetrics()]);
    log("info", "worker.queue_metrics", {
      ...jobMetrics,
      ...outboxMetrics,
      scopedConcurrency: scopedConcurrency.snapshot(),
    });
  } catch (error) {
    log("warn", "worker.metrics_failed", { errorClass: errorClass(error) });
  }

  try {
    const snapshot = await operations.collectSliSnapshot();
    log("info", "worker.control_plane_sli", snapshot);
  } catch (error) {
    log("warn", "worker.control_plane_sli_failed", { errorClass: errorClass(error) });
  }
}

async function purgeExpiredInbox(currentTime: number): Promise<void> {
  if (currentTime < nextRetentionCleanupAt) return;
  nextRetentionCleanupAt = currentTime + retentionCleanupIntervalMilliseconds;
  try {
    const purged = await jobs.purgeExpired();
    if (purged > 0) log("info", "worker.retention_cleanup", { purged });
  } catch (error) {
    log("warn", "worker.retention_cleanup_failed", { errorClass: errorClass(error) });
  }
}

async function claimAvailableJobs(): Promise<ClaimedControlPlaneJob[]> {
  lastPollAt = new Date().toISOString();
  try {
    return jobs.claimJobs({ workerId, limit: concurrency });
  } catch (error) {
    log("error", "worker.claim_failed", { workerId, errorClass: errorClass(error) });
    return [];
  }
}

async function claimAvailableOutboxEffects(): Promise<ClaimedControlPlaneOutboxEffect[]> {
  lastOutboxPollAt = new Date().toISOString();
  try {
    return outbox.claimEffects({ workerId, limit: outboxConcurrency });
  } catch (error) {
    log("error", "worker.outbox_claim_failed", { workerId, errorClass: errorClass(error) });
    return [];
  }
}

async function processClaimedJobs(claimed: ClaimedControlPlaneJob[]): Promise<void> {
  const completed = await Promise.all(
    claimed.map(async (job) => ({
      correlation: jobCorrelation(job),
      result: await scopedConcurrency.run(workerScopeFromJob(job), () =>
        processControlPlaneJob(job, {
          workerId,
          jobs,
          lifecycle,
        }),
      ),
    })),
  );
  for (const { correlation, result } of completed) {
    if (result.status === "completed") lastSuccessfulJobAt = new Date().toISOString();
    log(result.status === "completed" ? "info" : "warn", "worker.job_terminal", {
      workerId,
      ...correlation,
      status: result.status,
    });
  }
}

async function processClaimedOutboxEffects(claimed: ClaimedControlPlaneOutboxEffect[]): Promise<void> {
  if (!durableCheckRuns) return;
  const completed = await Promise.all(
    claimed.map(async (effect) => ({
      correlation: outboxCorrelation(effect),
      result: await scopedConcurrency.run(workerScopeFromOutboxEffect(effect), () =>
        processControlPlaneOutboxEffect(effect, {
          workerId,
          outbox,
          dispatchMode,
          checkRuns: durableCheckRuns,
          ...(workflowDispatch ? { workflowDispatch } : {}),
        }),
      ),
    })),
  );
  for (const { correlation, result } of completed) {
    if (result.status === "completed") lastSuccessfulOutboxEffectAt = new Date().toISOString();
    log(result.status === "completed" ? "info" : "warn", "worker.outbox_effect_terminal", {
      workerId,
      ...correlation,
      status: result.status,
    });
  }
}

async function runLifecycleLoop(): Promise<void> {
  while (!shuttingDown) {
    if (!lifecycleConfigurationValid) {
      await sleep(pollMilliseconds);
      continue;
    }
    const claimed = await claimAvailableJobs();
    if (claimed.length === 0) {
      await sleep(pollMilliseconds);
      continue;
    }
    await processClaimedJobs(claimed);
  }
}

async function runOutboxLoop(): Promise<void> {
  while (!shuttingDown) {
    if (!outboxConfigurationValid) {
      await sleep(outboxPollMilliseconds);
      continue;
    }
    const claimed = await claimAvailableOutboxEffects();
    if (claimed.length === 0) {
      await sleep(outboxPollMilliseconds);
      continue;
    }
    await processClaimedOutboxEffects(claimed);
  }
}

async function runMaintenanceLoop(): Promise<void> {
  while (!shuttingDown) {
    const currentTime = Date.now();
    await collectQueueMetrics(currentTime);
    await purgeExpiredInbox(currentTime);
    await sleep(1000);
  }
}

let activeLoops: Promise<unknown> = Promise.resolve();
let shutdownPromise: Promise<void> | undefined;

async function closeHealthServer(): Promise<void> {
  if (!healthServer.listening) return;
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });
}

function shutdown(signal: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  ready = false;
  log("info", "worker.shutdown_started", { workerId, signal, ...scopedConcurrency.snapshot() });
  shutdownPromise = (async () => {
    await closeHealthServer();
    await activeLoops;
    await executor.close();
    log("info", "worker.shutdown_completed", { workerId, signal });
  })();
  return shutdownPromise;
}

async function handleSignal(signal: string): Promise<void> {
  try {
    await shutdown(signal);
    process.exitCode = 0;
  } catch (error) {
    log("error", "worker.shutdown_failed", { workerId, signal, errorClass: errorClass(error) });
    process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void handleSignal(signal));
}

try {
  await startHealthServer();
  activeLoops = Promise.all([runLifecycleLoop(), runOutboxLoop(), runMaintenanceLoop()]);
  await activeLoops;
} catch (error) {
  shuttingDown = true;
  ready = false;
  log("error", "worker.fatal", { workerId, errorClass: errorClass(error) });
  await closeHealthServer().catch(() => undefined);
  await executor.close().catch(() => undefined);
  process.exitCode = 1;
}
