import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";

type RunnerCommandResult = {
  stdout: string;
  stderr: string;
};

export type RunnerCommandExecutor = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<RunnerCommandResult>;

export type CheckoutRunnerSourceOptions = {
  job: RunnerClaimedJob;
  workspaceRoot: string;
  repositoryMirrorRoot?: string;
  execute?: RunnerCommandExecutor;
};

const maximumCommandOutputBytes = 1024 * 1024;

export async function checkoutRunnerSource(options: CheckoutRunnerSourceOptions): Promise<string> {
  if (options.job.sourceMode !== "customer_checkout") {
    throw new Error("self-hosted runners accept only customer_checkout source assignments");
  }
  const workspaceRoot = path.resolve(options.workspaceRoot);
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(workspaceRoot, 0o700);
  const workspace = await mkdtemp(path.join(workspaceRoot, `${options.job.runId}-${options.job.executionAttemptId}-`));
  if (process.platform !== "win32") await chmod(workspace, 0o700);

  const execute = options.execute ?? executeRunnerCommand;
  const environment = sanitizedGitEnvironment(process.env);
  const repository = repositoryRemote(options.job, options.repositoryMirrorRoot);
  const git = async (args: readonly string[]) =>
    await execute("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: workspace,
      env: environment,
    });

  try {
    await git(["init", "--quiet"]);
    await git(["remote", "add", "origin", repository]);
    await git(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", options.job.repository.commitSha]);
    await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    const resolved = (await git(["rev-parse", "HEAD"])).stdout.trim();
    if (resolved !== options.job.repository.commitSha) {
      throw new Error(`checked-out commit did not match the assigned commit: ${resolved}`);
    }
    await git(["remote", "remove", "origin"]);
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

async function executeRunnerCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<RunnerCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputExceeded = false;
    const collect = (current: string, chunk: string): string => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > maximumCommandOutputBytes) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return current;
      }
      return `${current}${chunk}`;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = collect(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = { stdout, stderr };
      if (outputExceeded) {
        reject(new Error(`${command} output exceeded ${maximumCommandOutputBytes} bytes`));
        return;
      }
      if (code !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        const termination = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        const detailSuffix = detail ? `: ${detail}` : "";
        reject(new Error(`${command} ${args.join(" ")} failed with ${termination}${detailSuffix}`));
        return;
      }
      resolve(result);
    });
  });
}

function repositoryRemote(job: RunnerClaimedJob, repositoryMirrorRoot: string | undefined): string {
  if (!repositoryMirrorRoot) {
    return `https://github.com/${job.repository.owner}/${job.repository.name}.git`;
  }
  const root = path.resolve(repositoryMirrorRoot);
  const candidate = path.resolve(root, job.repository.owner, `${job.repository.name}.git`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("repository mirror path escaped the configured mirror root");
  }
  return candidate;
}

function sanitizedGitEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = { ...environment, GIT_TERMINAL_PROMPT: "0" };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_PREFIX",
  ]) {
    delete sanitized[name];
  }
  return sanitized;
}
