import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const DEFAULT_FAIL_AT_RATIO = 0.9;
const NPM_PACK_MAX_BUFFER = 16 * 1024 * 1024;
const PACK_BUDGET = { budget: 6_000_000, failAtRatio: DEFAULT_FAIL_AT_RATIO };
const UNPACK_BUDGET = { budget: 32_000_000, failAtRatio: DEFAULT_FAIL_AT_RATIO };
const BUDGETS = {
  "dist/action/index.cjs": { budget: 16_000_000, failAtRatio: DEFAULT_FAIL_AT_RATIO },
  "dist/cli/index.cjs": { budget: 12_500_000, failAtRatio: DEFAULT_FAIL_AT_RATIO },
};
const writeLine = (message) => process.stdout.write(`${message}\n`);

export function normalizeSizePolicy(policy, label = "size budget") {
  const candidate = typeof policy === "number" ? { budget: policy } : (policy ?? {});
  const budget = candidate.budget;
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`${label} must define a positive numeric budget`);
  }
  const failAtRatio =
    Number.isFinite(candidate.failAtRatio) && candidate.failAtRatio > 0 ? candidate.failAtRatio : DEFAULT_FAIL_AT_RATIO;
  return { budget, failAtRatio };
}

export function parseNpmPackOutput(raw) {
  const jsonStart = raw.indexOf("[");
  const parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw);
  const packResult = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!packResult || !Number.isFinite(packResult.size) || !Number.isFinite(packResult.unpackedSize)) {
    throw new Error("npm pack output did not include numeric size metadata");
  }

  return packResult;
}

export function resolveNpmCliPath(
  nodeExecutable = process.execPath,
  platform = process.platform,
  fileExists = existsSync,
) {
  const pathApi = platform === "win32" ? win32 : posix;
  const nodeDirectory = pathApi.dirname(nodeExecutable);
  const candidates =
    platform === "win32"
      ? [pathApi.resolve(nodeDirectory, "node_modules/npm/bin/npm-cli.js")]
      : [
          pathApi.resolve(nodeDirectory, "../lib/node_modules/npm/bin/npm-cli.js"),
          pathApi.resolve(nodeDirectory, "node_modules/npm/bin/npm-cli.js"),
        ];
  const npmCliPath = candidates.find((candidate) => fileExists(candidate));
  if (!npmCliPath) {
    throw new Error(`npm CLI was not found beside the Node.js runtime: ${nodeExecutable}`);
  }
  return npmCliPath;
}

export function formatChildProcessStderr(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }
  return typeof value === "string" ? value.trim() : "";
}

function runNpmPack(root) {
  const npmCliPath = resolveNpmCliPath();
  const raw = execFileSync(process.execPath, [npmCliPath, "pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    maxBuffer: NPM_PACK_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseNpmPackOutput(raw);
}

function checkBudget(label, actual, rawPolicy) {
  const policy = normalizeSizePolicy(rawPolicy, label);
  const ratio = actual / policy.budget;
  const status = ratio <= policy.failAtRatio ? "PASS" : "FAIL";
  writeLine(
    `  ${status}  ${label}: ${(actual / 1_000_000).toFixed(2)} MB / ${(policy.budget / 1_000_000).toFixed(2)} MB (${(ratio * 100).toFixed(1)}%, fail-at ${(policy.failAtRatio * 100).toFixed(0)}%)`,
  );
  return status === "FAIL";
}

function checkBundleBudgets(root) {
  let failed = false;
  writeLine("Bundle size budget check");
  writeLine("========================");

  for (const [relativePath, policy] of Object.entries(BUDGETS)) {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath)) {
      writeLine(`  FAIL  ${relativePath}: not found`);
      failed = true;
      continue;
    }
    failed = checkBudget(relativePath, statSync(absolutePath).size, policy) || failed;
  }
  return failed;
}

function checkPackBudgets(packResult) {
  writeLine("");
  writeLine("npm pack size budget check");
  writeLine("==========================");
  const packedFailed = checkBudget("packed size", packResult.size, PACK_BUDGET);
  const unpackedFailed = checkBudget("unpacked size", packResult.unpackedSize, UNPACK_BUDGET);
  return packedFailed || unpackedFailed;
}

function reportPackFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = error && typeof error === "object" && "stderr" in error ? formatChildProcessStderr(error.stderr) : "";
  writeLine(`  FAIL  npm pack --dry-run failed: ${message}`);
  if (stderr) {
    writeLine(stderr);
  }
}

function main() {
  let failed = checkBundleBudgets(ROOT);
  try {
    failed = checkPackBudgets(runNpmPack(ROOT)) || failed;
  } catch (error) {
    reportPackFailure(error);
    failed = true;
  }
  writeLine(`\nExit code: ${failed ? 1 : 0}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
