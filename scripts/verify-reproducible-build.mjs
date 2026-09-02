import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIST_FILES = ["dist/action/index.cjs", "dist/cli/index.cjs"];

export async function hashDistFiles(root, readFileImpl = readFile) {
  const hash = createHash("sha256");
  for (const file of DIST_FILES) {
    hash.update(await readFileImpl(join(root, file)));
  }
  return hash.digest("hex");
}

export function evaluateCleanRoomRebuild({ sourceDigest, cleanRoomDigest }) {
  if (!sourceDigest) return { passed: false, reason: "source dist digest could not be computed" };
  if (!cleanRoomDigest) return { passed: false, reason: "clean-room dist digest could not be computed" };
  if (sourceDigest !== cleanRoomDigest) {
    return {
      passed: false,
      reason: `dist digest mismatch: source build produced ${sourceDigest}, clean-room build produced ${cleanRoomDigest}`,
    };
  }
  return { passed: true, reason: `both builds produced dist digest ${sourceDigest}` };
}

export async function runCleanRoomRebuild({
  root = process.cwd(),
  execImpl = defaultExec,
  mkdtempImpl = mkdtemp,
  rmImpl = rm,
  readFileImpl = readFile,
  pnpmCli = process.env.npm_execpath,
  nodeExecutable = process.execPath,
} = {}) {
  if (!pnpmCli) throw new Error("npm_execpath is required to run the pinned pnpm CLI (run via corepack pnpm run ...)");
  const runPnpm = (args, options) => execImpl(nodeExecutable, [pnpmCli, ...args], options);

  const status = execImpl("git", ["status", "--porcelain"], { cwd: root });
  if (status.stdout.trim() !== "") {
    throw new Error("working tree has uncommitted changes; clean-room rebuild only compares committed source");
  }
  const commit = execImpl("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();

  const workdir = await mkdtempImpl(join(tmpdir(), "boardreadyops-clean-room-"));
  try {
    execImpl("git", ["worktree", "add", "--detach", "--force", workdir, commit], { cwd: root });
    runPnpm(["install", "--frozen-lockfile"], { cwd: workdir });
    runPnpm(["run", "build"], { cwd: workdir });
    const cleanRoomDigest = await hashDistFiles(workdir, readFileImpl);

    runPnpm(["run", "build"], { cwd: root });
    const sourceDigest = await hashDistFiles(root, readFileImpl);

    return { commit, sourceDigest, cleanRoomDigest, ...evaluateCleanRoomRebuild({ sourceDigest, cleanRoomDigest }) };
  } finally {
    execImpl("git", ["worktree", "remove", "--force", workdir], { cwd: root, allowFailure: true });
    await rmImpl(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

function defaultExec(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, ...options }); // NOSONAR -- command/args are fixed internal calls, not attacker-controlled.
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}):\n${result.stderr}`);
  }
  return result;
}

async function main() {
  const result = await runCleanRoomRebuild({});
  process.stdout.write(`commit: ${result.commit}\n`);
  process.stdout.write(`source dist digest:     ${result.sourceDigest}\n`);
  process.stdout.write(`clean-room dist digest: ${result.cleanRoomDigest}\n`);
  if (!result.passed) {
    process.stderr.write(`clean-room rebuild verification failed: ${result.reason}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`ok: ${result.reason}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
