import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import glob from "fast-glob";

export const defaultMutationThresholds = Object.freeze([
  { name: "overall", minimum: 60, filePattern: "all files", matches: () => true },
  {
    name: "src/core/**",
    minimum: 75,
    filePattern: "src/core/**",
    matches: (file) => normalizeFile(file).startsWith("src/core/"),
  },
  {
    name: "src/kicad/parser-model",
    minimum: 65,
    filePattern: "src/kicad/{sexpr,pcb,schematic,schematic-graph}.ts",
    matches: (file) => parserModelMutationFiles.has(normalizeFile(file)),
  },
  {
    name: "src/rules/manufacturing/**",
    minimum: 60,
    filePattern: "src/rules/manufacturing/**",
    matches: (file) => normalizeFile(file).startsWith("src/rules/manufacturing/"),
  },
]);

const detectedStatuses = new Set(["Killed", "Timeout"]);
const undetectedStatuses = new Set(["Survived", "NoCoverage"]);
const coreMutationExcludes = new Set(["src/core/context.ts", "src/core/result.ts"]);

export function isExecutableMutationFile(file) {
  const normalized = normalizeFile(file);
  return !coreMutationExcludes.has(normalized) && !normalized.endsWith(".d.ts") && !normalized.endsWith(".types.ts");
}
const parserModelMutationFiles = new Set([
  "src/kicad/sexpr.ts",
  "src/kicad/pcb.ts",
  "src/kicad/schematic.ts",
  "src/kicad/schematic-graph.ts",
]);
const requiredMutationFiles = new Map([
  ["src/kicad/parser-model", [...parserModelMutationFiles].sort()],
  [
    "src/rules/manufacturing/**",
    [
      "src/rules/manufacturing/fiducials.ts",
      "src/rules/manufacturing/jobset-outputs.ts",
      "src/rules/manufacturing/layer-stackup.ts",
      "src/rules/manufacturing/outputs-present.ts",
      "src/rules/manufacturing/position-coverage.ts",
      "src/rules/manufacturing/shared.ts",
      "src/rules/manufacturing/tooling-holes.ts",
    ].sort(),
  ],
]);

export function normalizeFile(file) {
  return file.split(path.sep).join("/").replace(/\\/g, "/");
}

export function calculateMutationMetrics(report, matches = () => true) {
  const counts = {
    files: 0,
    killed: 0,
    timeout: 0,
    survived: 0,
    noCoverage: 0,
    totalDetected: 0,
    totalUndetected: 0,
    totalValid: 0,
    mutationScore: Number.NaN,
  };
  for (const [file, result] of Object.entries(report.files ?? {})) {
    if (!matches(file)) {
      continue;
    }
    counts.files += 1;
    for (const mutant of result.mutants ?? []) {
      if (detectedStatuses.has(mutant.status)) {
        counts.totalDetected += 1;
        counts[mutant.status === "Killed" ? "killed" : "timeout"] += 1;
      } else if (undetectedStatuses.has(mutant.status)) {
        counts.totalUndetected += 1;
        counts[mutant.status === "Survived" ? "survived" : "noCoverage"] += 1;
      }
    }
  }
  counts.totalValid = counts.totalDetected + counts.totalUndetected;
  counts.mutationScore = counts.totalValid > 0 ? (counts.totalDetected / counts.totalValid) * 100 : Number.NaN;
  return counts;
}

export function checkMutationThresholds(report, thresholds = defaultMutationThresholds) {
  return thresholds.map((threshold) => {
    const metrics = calculateMutationMetrics(report, threshold.matches);
    const passed =
      metrics.files > 0 && Number.isFinite(metrics.mutationScore) && metrics.mutationScore >= threshold.minimum;
    return { ...threshold, metrics, passed };
  });
}

export function formatMutationSummary(results) {
  const lines = [
    "## Mutation Score",
    "",
    "| Scope | Files | Score | Minimum | Detected | Survived | No coverage | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const result of results) {
    const { metrics } = result;
    lines.push(
      [
        result.name,
        metrics.files,
        formatPercent(metrics.mutationScore),
        `${formatPercent(result.minimum)}`,
        metrics.totalDetected,
        metrics.survived,
        metrics.noCoverage,
        result.passed ? "pass" : "fail",
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatFailures(results) {
  return results
    .filter((result) => !result.passed)
    .map((result) => {
      if (result.metrics.files === 0) {
        return `${result.name} mutation threshold could not be checked because no report files matched ${result.filePattern}.`;
      }
      if (!Number.isFinite(result.metrics.mutationScore)) {
        return `${result.name} mutation threshold could not be checked because there are no valid mutants.`;
      }
      return `${result.name} mutation score ${formatPercent(result.metrics.mutationScore)} is below ${formatPercent(
        result.minimum,
      )}.`;
    });
}

export async function expectedCoreMutationFiles(root = process.cwd()) {
  const files = await glob("src/core/**/*.ts", { cwd: root, onlyFiles: true });
  return files.map(normalizeFile).filter(isExecutableMutationFile).sort();
}

export function missingMutationFiles(report, expectedFiles) {
  const reportedFiles = new Set(Object.keys(report.files ?? {}).map(normalizeFile));
  return expectedFiles.filter((file) => !reportedFiles.has(file));
}

export function formatMissingMutationFiles(missingFiles, scope = "src/core/**") {
  if (missingFiles.length === 0) {
    return [];
  }
  return [`${scope} mutation report is missing executable files:\n${missingFiles.join("\n")}`];
}

export function missingRequiredMutationFiles(report) {
  const failures = [];
  for (const [scope, files] of requiredMutationFiles) {
    failures.push(...formatMissingMutationFiles(missingMutationFiles(report, files), scope));
  }
  return failures;
}

export async function main(argv = process.argv.slice(2), env = process.env, root = process.cwd()) {
  const options = parseArgs(argv);
  const reportPath = path.resolve(root, options.report);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const results = checkMutationThresholds(report);
  const summary = formatMutationSummary(results);
  process.stdout.write(summary);
  if (options.summary) {
    const summaryPath = options.summaryFile ?? env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      await appendFile(summaryPath, `\n${summary}`, "utf8");
    }
  }
  const failures = [
    ...formatFailures(results),
    ...formatMissingMutationFiles(missingMutationFiles(report, await expectedCoreMutationFiles(root)), "src/core/**"),
    ...missingRequiredMutationFiles(report),
  ];
  if (failures.length > 0 && !options.noFail) {
    throw new Error(`mutation thresholds failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
}

function parseArgs(argv) {
  const options = {
    report: "reports/mutation/report.json",
    summary: false,
    summaryFile: undefined,
    noFail: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--report") {
      options.report = readValue(argv, ++index, arg);
    } else if (arg === "--summary") {
      options.summary = true;
    } else if (arg === "--summary-file") {
      options.summary = true;
      options.summaryFile = readValue(argv, ++index, arg);
    } else if (arg === "--no-fail") {
      options.noFail = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "n/a";
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
