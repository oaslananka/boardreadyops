import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const defaultRequiredChecks = Object.freeze([
  "Dangerous-Workflow",
  "Dependency-Update-Tool",
  "Fuzzing",
  "License",
  "Pinned-Dependencies",
  "SAST",
  "Security-Policy",
  "Token-Permissions",
  "Vulnerabilities",
]);

export function checkScorecardBaseline(report, options = {}) {
  const minimum = options.minimum ?? 9;
  const requiredChecks = options.requiredChecks ?? defaultRequiredChecks;
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const byName = new Map(checks.map((check) => [check.name, check]));
  const failures = [];

  if (!Number.isFinite(report.score) || report.score < minimum) {
    failures.push(`aggregate score ${formatScore(report.score)} is below ${formatScore(minimum)}`);
  }

  for (const name of requiredChecks) {
    const check = byName.get(name);
    if (!check) {
      failures.push(`${name} check is missing from the report`);
      continue;
    }
    if (!Number.isFinite(check.score) || check.score < minimum) {
      failures.push(`${name} score ${formatScore(check.score)} is below ${formatScore(minimum)}: ${check.reason}`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    summary: formatScorecardSummary(report, requiredChecks, minimum),
  };
}

export function formatScorecardSummary(report, requiredChecks = defaultRequiredChecks, minimum = 9) {
  const checks = new Map((report.checks ?? []).map((check) => [check.name, check]));
  const lines = [
    "## OpenSSF Scorecard Baseline",
    "",
    `Aggregate score: ${formatScore(report.score)} (minimum ${formatScore(minimum)})`,
    "",
    "| Check | Score | Result | Reason |",
    "| --- | ---: | --- | --- |",
  ];

  for (const name of requiredChecks) {
    const check = checks.get(name);
    if (!check) {
      lines.push(`| ${name} | n/a | fail | missing from report |`);
      continue;
    }
    const passed = Number.isFinite(check.score) && check.score >= minimum;
    lines.push(`| ${name} | ${formatScore(check.score)} | ${passed ? "pass" : "fail"} | ${escapeCell(check.reason)} |`);
  }

  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2), env = process.env, root = process.cwd()) {
  const options = parseArgs(argv);
  const reportPath = path.resolve(root, options.report);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = checkScorecardBaseline(report, {
    minimum: options.minimum,
    requiredChecks: options.requiredChecks,
  });

  process.stdout.write(result.summary);
  await appendSummary(options, env, result.summary);

  if (!result.passed && !options.noFail) {
    const formattedFailures = result.failures.map((failure) => `- ${failure}`).join("\n");
    throw new Error(`scorecard baseline failed:\n${formattedFailures}`);
  }
}

async function appendSummary(options, env, summary) {
  const summaryPath = options.summary ? (options.summaryFile ?? env.GITHUB_STEP_SUMMARY) : undefined;
  if (summaryPath) {
    await appendFile(summaryPath, `\n${summary}`, "utf8");
  }
}

function parseArgs(argv) {
  const options = {
    report: "scorecard.json",
    minimum: 9,
    requiredChecks: defaultRequiredChecks,
    summary: false,
    summaryFile: undefined,
    noFail: false,
  };

  let index = 0;
  function nextValue(flag) {
    index += 1;
    const value = argv[index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  while (index < argv.length) {
    const flag = argv[index];
    switch (flag) {
      case "--":
        break;
      case "--report":
        options.report = nextValue(flag);
        break;
      case "--minimum": {
        options.minimum = Number.parseFloat(nextValue(flag));
        if (!Number.isFinite(options.minimum)) {
          throw new TypeError("--minimum must be a number");
        }
        break;
      }
      case "--checks":
        options.requiredChecks = nextValue(flag)
          .split(",")
          .map((check) => check.trim())
          .filter(Boolean);
        break;
      case "--summary":
        options.summary = true;
        break;
      case "--summary-file":
        options.summary = true;
        options.summaryFile = nextValue(flag);
        break;
      case "--no-fail":
        options.noFail = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
    index += 1;
  }

  return options;
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "n/a";
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", String.raw`\|`)
    .replace(/\r?\n/g, "<br>");
}

if (isDirectInvocation()) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function isDirectInvocation() {
  return process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false;
}
