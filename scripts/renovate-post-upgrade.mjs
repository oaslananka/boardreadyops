import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function createRenovateEnvironment(storeDir, baseEnv = process.env) {
  return {
    ...baseEnv,
    pnpm_config_store_dir: storeDir,
  };
}

export function renovateCommandPlan() {
  return [
    ["corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]],
    ["corepack", ["pnpm", "rebuild", "@prisma/engines", "esbuild", "prisma", "sharp"]],
    ["corepack", ["pnpm", "run", "notice"]],
    ["corepack", ["pnpm", "run", "build"]],
  ];
}

/**
 * Read the versions pnpm refused for being inside its release-quarantine window.
 *
 * Two safety controls disagree here, and both are right. pnpm will not lock a release younger
 * than minimumReleaseAge, because that is the window a compromised publish gets caught in.
 * Renovate will not sit on a high-severity advisory for a week. So a security bump arrives
 * pointing at a release pnpm refuses, the install fails, and since the install is the first
 * thing this script runs, `notice` and `build` never happen either -- one blocked step reads as
 * forty broken jobs.
 *
 * The refusal names exactly which versions it objected to, which is what makes this safe to
 * automate: nothing is inferred, and nothing is admitted that pnpm did not just stop.
 */
export function parseQuarantinedVersions(stderr) {
  if (!stderr.includes("ERR_PNPM_NO_MATURE_MATCHING_VERSION")) return [];
  const found = [];
  for (const line of stderr.split("\n")) {
    const match = /^\s*(\S+?)@(\d[^\s]*)\s+was published at\b/u.exec(line);
    if (match && !found.includes(`${match[1]}@${match[2]}`)) found.push(`${match[1]}@${match[2]}`);
  }
  return found;
}

/**
 * Add those versions to the quarantine allowlist the repository already keeps.
 *
 * minimumReleaseAgeExclude exists for exactly this: every entry in it is a past security bump
 * somebody admitted deliberately. Writing the entry is bookkeeping for a decision the override
 * itself already records, so it happens here instead of by hand on every pull request.
 *
 * Strictly additive. An existing entry is never rewritten or removed, because entries such as
 * 'nanoid@3.3.17 || 3.3.18' admit more than one version on purpose, and deciding a version is no
 * longer trusted is a judgement rather than something to infer from a bump. The list is edited
 * as text so the comments explaining each admission stay attached to the lines they annotate.
 */
export function admitQuarantinedVersions(workspace, versions) {
  if (versions.length === 0) return workspace;
  const lines = workspace.split("\n");
  const heading = lines.findIndex((line) => line.startsWith("minimumReleaseAgeExclude:"));
  if (heading === -1) return workspace;

  let end = heading + 1;
  while (end < lines.length && (lines[end].startsWith("  ") || lines[end].trim() === "")) end += 1;
  const existing = new Set();
  for (let index = heading + 1; index < end; index += 1) {
    const entry = /^\s*-\s*'?([^']+?)'?\s*$/u.exec(lines[index]);
    if (entry) existing.add(entry[1].trim());
  }

  const additions = versions.filter((version) => !existing.has(version)).map((version) => `  - '${version}'`);
  if (additions.length === 0) return workspace;

  let last = end - 1;
  while (last > heading && lines[last].trim() === "") last -= 1;
  lines.splice(last + 1, 0, ...additions);
  return lines.join("\n");
}

async function runCommand(command, args, options) {
  const capture = options.capture === true;
  let stderr = "";
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: capture ? ["inherit", "inherit", "pipe"] : "inherit",
      windowsHide: true,
    });
    if (capture && child.stderr) {
      child.stderr.on("data", (chunk) => {
        // Still shown, so a failure reads the same in the log as it always did.
        stderr += chunk.toString();
        process.stderr.write(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const failure = new Error(`${command} ${args.join(" ")} failed with ${detail}`);
      failure.stderr = stderr;
      reject(failure);
    });
  });
  return stderr;
}

export async function main(root = process.cwd(), options = {}) {
  const makeTemp = options.makeTemp ?? ((prefix) => mkdtemp(path.join(tmpdir(), prefix)));
  const remove = options.remove ?? ((target, removeOptions) => rm(target, removeOptions));
  const run = options.run ?? runCommand;
  const read = options.readWorkspace ?? ((target) => readFile(target, "utf8"));
  const write = options.writeWorkspace ?? ((target, contents) => writeFile(target, contents, "utf8"));
  await remove(path.join(root, "node_modules"), { recursive: true, force: true });
  const storeDir = await makeTemp("boardreadyops-renovate-pnpm-");
  const env = createRenovateEnvironment(storeDir, options.baseEnv ?? process.env);

  try {
    const [install, ...rest] = renovateCommandPlan();
    try {
      await run(install[0], install[1], { cwd: root, env, capture: true });
    } catch (error) {
      // Admit only what pnpm just named, then give the install exactly one more attempt. A
      // second refusal is a real problem and is allowed to fail the task.
      const quarantined = parseQuarantinedVersions(error?.stderr ?? "");
      if (quarantined.length === 0) throw error;
      const target = path.join(root, "pnpm-workspace.yaml");
      const admitted = admitQuarantinedVersions(await read(target), quarantined);
      await write(target, admitted);
      await run(install[0], install[1], { cwd: root, env });
    }
    for (const [command, args] of rest) {
      await run(command, args, { cwd: root, env });
    }
  } finally {
    await remove(storeDir, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
