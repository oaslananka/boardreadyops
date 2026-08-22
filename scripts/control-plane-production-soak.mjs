import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { summarizeDurations } from "./control-plane-load.mjs";
import {
  boundedEnvironmentInteger as boundedInteger,
  requiredEnvironmentValue as required,
  isBareHttpsOrigin as validBareHttpsOrigin,
} from "./lib/environment.mjs";

const readyPath = "/api/health/ready";

const defaultValues = {
  durationMinutes: 240,
  intervalSeconds: 60,
  requestTimeoutMs: 10_000,
  maxConsecutiveFailures: 3,
  latencyP95Ms: 2_000,
  minimumAvailabilityPercent: 99,
};

export class ProductionSoakError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "ProductionSoakError";
    this.reason = reason;
    this.details = details;
  }
}

export function readProductionSoakOptions(environment = process.env) {
  const origin = required(environment, "BOARDREADYOPS_SOAK_ORIGIN").replace(/\/$/u, "");
  if (!validBareHttpsOrigin(`${origin}/`)) {
    throw new Error("BOARDREADYOPS_SOAK_ORIGIN must be an HTTPS origin");
  }
  return {
    origin,
    readyPath,
    durationMinutes: boundedInteger(
      environment,
      "BOARDREADYOPS_SOAK_DURATION_MINUTES",
      defaultValues.durationMinutes,
      5,
      720,
    ),
    intervalSeconds: boundedInteger(
      environment,
      "BOARDREADYOPS_SOAK_INTERVAL_SECONDS",
      defaultValues.intervalSeconds,
      5,
      900,
    ),
    requestTimeoutMs: boundedInteger(
      environment,
      "BOARDREADYOPS_SOAK_REQUEST_TIMEOUT_MS",
      defaultValues.requestTimeoutMs,
      1_000,
      60_000,
    ),
    maxConsecutiveFailures: boundedInteger(
      environment,
      "BOARDREADYOPS_SOAK_MAX_CONSECUTIVE_FAILURES",
      defaultValues.maxConsecutiveFailures,
      1,
      20,
    ),
    reportPath: environment.BOARDREADYOPS_SOAK_REPORT_PATH?.trim() || undefined,
    thresholds: {
      latencyP95Ms: boundedInteger(
        environment,
        "BOARDREADYOPS_SOAK_LATENCY_P95_MS",
        defaultValues.latencyP95Ms,
        50,
        60_000,
      ),
      minimumAvailabilityPercent: boundedInteger(
        environment,
        "BOARDREADYOPS_SOAK_MINIMUM_AVAILABILITY_PERCENT",
        defaultValues.minimumAvailabilityPercent,
        50,
        100,
      ),
    },
  };
}

function rounded(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeLatencies(durations, elapsedMs) {
  if (durations.length === 0) {
    return {
      count: 0,
      elapsedMs: rounded(elapsedMs),
      throughputPerSecond: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maximumMs: 0,
    };
  }
  return summarizeDurations(durations, elapsedMs);
}

async function sampleReadyEndpoint(runtime, options) {
  const url = `${options.origin}${options.readyPath}`;
  const startedAt = runtime.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  try {
    const response = await runtime.request(url, { signal: controller.signal });
    const latencyMs = runtime.now() - startedAt;
    return { ok: response.status === 200, statusCode: response.status, latencyMs };
  } catch {
    return { ok: false, statusCode: undefined, latencyMs: undefined };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runProductionSoakMonitor(options, dependencies = {}) {
  const runtime = {
    request: dependencies.request ?? fetch,
    sleep: dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: dependencies.now ?? (() => Date.now()),
  };
  const startedAt = runtime.now();
  const durationMs = options.durationMinutes * 60_000;
  const intervalMs = options.intervalSeconds * 1_000;
  const latencies = [];
  let samplesTaken = 0;
  let successCount = 0;
  let consecutiveFailures = 0;
  let terminatedEarly = false;
  let terminationReason;

  for (;;) {
    const sample = await sampleReadyEndpoint(runtime, options);
    samplesTaken += 1;
    if (sample.latencyMs !== undefined) latencies.push(sample.latencyMs);
    if (sample.ok) {
      successCount += 1;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures >= options.maxConsecutiveFailures) {
        terminatedEarly = true;
        terminationReason = "max_consecutive_failures_exceeded";
        break;
      }
    }
    const elapsedMs = runtime.now() - startedAt;
    if (elapsedMs >= durationMs - intervalMs) break;
    await runtime.sleep(intervalMs);
  }

  const elapsedMs = runtime.now() - startedAt;
  const report = {
    event: "control_plane_production_soak_verified",
    scenario: {
      origin: options.origin,
      durationRequestedMinutes: options.durationMinutes,
      intervalSeconds: options.intervalSeconds,
      maxConsecutiveFailures: options.maxConsecutiveFailures,
    },
    samplesTaken,
    elapsedMinutes: rounded(elapsedMs / 60_000, 2),
    terminatedEarly,
    ...(terminatedEarly ? { terminationReason } : {}),
    ready: summarizeLatencies(latencies, elapsedMs),
    availability: {
      successCount,
      samplesTaken,
      availabilityPercent: rounded((successCount / samplesTaken) * 100, 2),
    },
  };
  return report;
}

export function evaluateProductionSoakReport(report, thresholds) {
  const signals = [];
  if (report.terminatedEarly) signals.push("soak_terminated_early");
  if (report.elapsedMinutes < report.scenario.durationRequestedMinutes) {
    signals.push("soak_duration_incomplete");
  }
  if (report.ready.p95Ms > thresholds.latencyP95Ms) signals.push("soak_latency_p95_exceeded");
  if (report.availability.availabilityPercent < thresholds.minimumAvailabilityPercent) {
    signals.push("soak_availability_below_minimum");
  }
  return signals;
}

async function writeReport(report, reportPath) {
  if (!reportPath) return;
  await appendFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const options = readProductionSoakOptions(process.env);
  const report = await runProductionSoakMonitor(options);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await writeReport(report, options.reportPath);
  const signals = evaluateProductionSoakReport(report, options.thresholds);
  if (signals.length > 0) {
    process.stderr.write(`${JSON.stringify(signals)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "production soak monitor failed"}\n`);
    process.exitCode = 1;
  }
}
