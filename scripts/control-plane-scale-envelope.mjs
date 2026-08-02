import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTROL_PLANE_SCALE_PRESETS = Object.freeze({
  baseline: Object.freeze({
    uniqueDeliveries: 200,
    duplicateDeliveries: 50,
    repositoryCount: 4,
    runsPerRepository: 20,
    concurrency: 20,
  }),
  medium: Object.freeze({
    uniqueDeliveries: 500,
    duplicateDeliveries: 100,
    repositoryCount: 8,
    runsPerRepository: 30,
    concurrency: 40,
  }),
  high: Object.freeze({
    uniqueDeliveries: 1_000,
    duplicateDeliveries: 200,
    repositoryCount: 12,
    runsPerRepository: 50,
    concurrency: 80,
  }),
});

const presetOrder = Object.freeze(["baseline", "medium", "high"]);
const shaPattern = /^[0-9a-f]{40}$/u;
const scenarioKeys = Object.freeze([
  "uniqueDeliveries",
  "duplicateDeliveries",
  "repositoryCount",
  "runsPerRepository",
  "concurrency",
]);
const measurementKeys = Object.freeze([
  "count",
  "elapsedMs",
  "throughputPerSecond",
  "p50Ms",
  "p95Ms",
  "p99Ms",
  "maximumMs",
]);

function selectedPreset(preset) {
  if (typeof preset !== "string" || !(preset in CONTROL_PLANE_SCALE_PRESETS)) {
    throw new Error("unknown control-plane scale preset");
  }
  return CONTROL_PLANE_SCALE_PRESETS[preset];
}

export function controlPlaneScaleEnvironment(preset) {
  const selected = selectedPreset(preset);
  return {
    BOARDREADYOPS_LOAD_PROFILE: "representative",
    BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES: String(selected.uniqueDeliveries),
    BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES: String(selected.duplicateDeliveries),
    BOARDREADYOPS_LOAD_REPOSITORIES: String(selected.repositoryCount),
    BOARDREADYOPS_LOAD_RUNS_PER_REPOSITORY: String(selected.runsPerRepository),
    BOARDREADYOPS_LOAD_CONCURRENCY: String(selected.concurrency),
  };
}

function finiteNumber(value, context) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${context} was not a non-negative finite number`);
  }
  return value;
}

function safeMeasurement(measurement, context) {
  if (typeof measurement !== "object" || measurement === null) {
    throw new Error(`${context} measurement was unavailable`);
  }
  return Object.fromEntries(measurementKeys.map((key) => [key, finiteNumber(measurement[key], `${context}.${key}`)]));
}

function scenarioMatchesPreset(scenario, preset) {
  if (typeof scenario !== "object" || scenario === null || scenario.profile !== "representative") return false;
  return scenarioKeys.every((key) => scenario[key] === preset[key]);
}

function expectedInvariants(preset) {
  const releaseRuns = preset.repositoryCount * preset.runsPerRepository;
  return {
    acceptedDeliveries: preset.uniqueDeliveries,
    duplicateDeliveries: preset.duplicateDeliveries,
    completedJobs: preset.uniqueDeliveries,
    releaseRuns,
    completedOutboxEffects: releaseRuns,
    scopedDashboardReads: preset.repositoryCount * 2,
    crossTenantMismatches: 0,
  };
}

function invariantsMatch(actual, expected) {
  return (
    typeof actual === "object" &&
    actual !== null &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function validatedTier(presetName, report) {
  const preset = selectedPreset(presetName);
  if (typeof report !== "object" || report === null || report.event !== "control_plane_load_verified") {
    throw new Error(`${presetName} scale report was not a control-plane load report`);
  }
  if (!scenarioMatchesPreset(report.scenario, preset)) {
    throw new Error(`${presetName} scale report scenario did not match its preset`);
  }
  if (!Array.isArray(report.signals) || report.signals.length > 0) {
    throw new Error(`${presetName} scale report contained threshold signals`);
  }
  if (!invariantsMatch(report.invariants, expectedInvariants(preset))) {
    throw new Error(`${presetName} scale report invariants did not converge`);
  }
  return {
    preset: presetName,
    scenario: { ...preset },
    databasePoolMaximum: Math.min(50, preset.concurrency + 4),
    intake: safeMeasurement(report.intake, `${presetName}.intake`),
    lifecycle: safeMeasurement(report.lifecycle, `${presetName}.lifecycle`),
    dashboard: safeMeasurement(report.dashboard, `${presetName}.dashboard`),
  };
}

export function summarizeControlPlaneScaleEnvelope(reports, options = {}) {
  if (typeof reports !== "object" || reports === null) throw new Error("scale reports are required");
  const sourceSha = options.sourceSha;
  if (sourceSha !== undefined && !shaPattern.test(sourceSha)) {
    throw new Error("scale envelope source SHA must be a 40-character lowercase hexadecimal commit");
  }
  const tiers = presetOrder.map((preset) => validatedTier(preset, reports[preset]));
  const high = selectedPreset("high");
  const maximumObservedP95Ms = Math.max(
    ...tiers.flatMap((tier) => [tier.intake.p95Ms, tier.lifecycle.p95Ms, tier.dashboard.p95Ms]),
  );
  return {
    event: "control_plane_scale_envelope_verified",
    ...(sourceSha ? { sourceSha } : {}),
    tiers,
    envelope: {
      maximumUniqueDeliveries: high.uniqueDeliveries,
      maximumReleaseRuns: high.repositoryCount * high.runsPerRepository,
      maximumConcurrency: high.concurrency,
      maximumDatabasePoolSize: Math.min(50, high.concurrency + 4),
      maximumObservedP95Ms,
      crossTenantMismatches: 0,
      thresholdSignals: 0,
    },
  };
}

async function writeEnvironment(preset, destination) {
  if (!destination) throw new Error("GitHub environment path is required");
  const lines = Object.entries(controlPlaneScaleEnvironment(preset)).map(([name, value]) => `${name}=${value}`);
  await appendFile(destination, `${lines.join("\n")}\n`, { encoding: "utf8" });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function summarizeDirectory(root, output) {
  if (!root || !output) throw new Error("scale report root and output path are required");
  const reports = Object.fromEntries(
    await Promise.all(
      presetOrder.map(async (preset) => [
        preset,
        await readJson(resolve(root, `control-plane-scale-${preset}`, "control-plane-load-report.json")),
      ]),
    ),
  );
  const summary = summarizeControlPlaneScaleEnvelope(reports, {
    ...(process.env.GITHUB_SHA ? { sourceSha: process.env.GITHUB_SHA } : {}),
  });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === "env") {
    await writeEnvironment(args[0], args[1]);
    return;
  }
  if (command === "summarize") {
    await summarizeDirectory(args[0], args[1]);
    return;
  }
  throw new Error("usage: control-plane-scale-envelope.mjs <env|summarize> ...");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "control-plane scale envelope failed"}\n`);
    process.exitCode = 1;
  }
}
