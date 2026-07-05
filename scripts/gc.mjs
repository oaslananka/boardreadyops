import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listFiles } from "./lib/files.mjs";

const root = process.cwd();
const failures = [];
const generatedBefore = await generatedContents();

run("node", ["scripts/generate-rule-docs.mjs"]);
run("node", ["scripts/update-action-inputs-docs.mjs"]);
run("node", ["scripts/generate-api-docs.mjs"]);
run("node", ["scripts/generate-release-history.mjs"]);
run("node", ["scripts/check-marketplace-listing.mjs"]);
run("node", ["scripts/verify-structure.mjs"]);
await checkGeneratedDrift(generatedBefore);
await checkDuplicateBlocks();
checkTrackedOperationalFiles();
checkUnusedDependencies();

if (failures.length > 0) {
  throw new Error(`garbage collection checks failed:\n${failures.map((entry) => `- ${entry}`).join("\n")}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    failures.push(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

async function checkGeneratedDrift(before) {
  const after = await generatedContents();
  const changed = [];
  for (const [file, content] of after) {
    if (before.get(file) !== content) {
      changed.push(relative(file));
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) {
      changed.push(relative(file));
    }
  }
  if (changed.length > 0) {
    failures.push(`generated documentation is stale:\n${changed.sort().join("\n")}`);
  }
}

async function generatedContents() {
  const docs = await listFiles(path.join(root, "docs"));
  const files = docs.concat(path.join(root, "README.md"));
  const contents = new Map();
  for (const file of files) {
    contents.set(file, await readFile(file, "utf8"));
  }
  return contents;
}

async function checkDuplicateBlocks() {
  const files = (await listFiles(path.join(root, "src")))
    .concat(await listFiles(path.join(root, "scripts")))
    .filter((file) => /\.(ts|mjs)$/.test(file));
  const blocks = new Map();
  for (const file of files) {
    const lines = (await readFile(file, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("//"));
    for (let index = 0; index <= lines.length - 8; index += 1) {
      const block = lines.slice(index, index + 8).join("\n");
      const first = blocks.get(block);
      const location = `${relative(file)}:${index + 1}`;
      if (first && !isAllowedDuplicate(block)) {
        failures.push(`duplicated 8-line block at ${first} and ${location}`);
        return;
      }
      blocks.set(block, location);
    }
  }
}

function checkTrackedOperationalFiles() {
  const patterns = ["PROMPT.md", "AUTONOMOUS_BUILD.md", "NEXT.md"];
  const tracked = spawnSync("git", ["ls-files", ...patterns], { encoding: "utf8" });
  if (tracked.status !== 0) {
    failures.push("git ls-files failed while checking private operational notes");
    return;
  }
  if (tracked.stdout.trim() !== "") {
    failures.push(`private operational notes are tracked:\n${tracked.stdout.trim()}`);
  }
  const orders = spawnSync("git", ["ls-files", "AGENT_ORDERS*.md"], { encoding: "utf8" });
  if (orders.status === 0 && orders.stdout.trim() !== "") {
    failures.push(`private operational notes are tracked:\n${orders.stdout.trim()}`);
  }
}

function checkUnusedDependencies() {
  const packageJson = JSON.parse(
    spawnSync("node", ["-p", "JSON.stringify(require('./package.json'))"], {
      encoding: "utf8",
    }).stdout,
  );
  const requiredByContract = new Set([
    "@actions/artifact",
    "@actions/core",
    "@actions/github",
    "@octokit/rest",
    "ajv",
    "ajv-formats",
    "commander",
    "cosmiconfig",
    "fast-glob",
    "js-yaml",
    "mustache",
    "picocolors",
    "zod",
  ]);
  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    if (!requiredByContract.has(name)) {
      failures.push(`dependency is outside the v1 contract: ${name}`);
    }
  }
}

function isAllowedDuplicate(block) {
  return (
    block.includes("createFinding({") ||
    block.includes("meta: {") ||
    block.includes("return output;") ||
    block.split("\n").every((line) => /^"[a-z][a-z0-9.-]+",?$/.test(line) || line === "]," || line === "]")
  );
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}
