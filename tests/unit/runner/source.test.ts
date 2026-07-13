import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunnerClaimedJob } from "../../../packages/contracts/src/index.js";
import { checkoutRunnerSource, type RunnerCommandExecutor } from "../../../src/runner/source.js";

const roots: string[] = [];
const commitSha = "a".repeat(40);

function job(sourceMode: RunnerClaimedJob["sourceMode"] = "customer_checkout"): RunnerClaimedJob {
  return {
    leaseId: "11111111-1111-4111-8111-111111111111",
    leaseToken: "l".repeat(43),
    runId: "22222222-2222-4222-8222-222222222222",
    executionAttemptId: "33333333-3333-4333-8333-333333333333",
    leaseExpiresAt: "2026-07-14T02:05:00.000Z",
    maximumLeaseExpiresAt: "2026-07-14T02:30:00.000Z",
    sourceMode,
    repository: {
      owner: "octo-org",
      name: "private-board",
      commitSha,
      private: true,
    },
    safeMode: { enabled: true, reasons: ["private-repository"] },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
});

describe("checkoutRunnerSource", () => {
  it("checks out the exact server-assigned commit using customer-controlled Git credentials", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-source-"));
    roots.push(root);
    const calls: Array<{ command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
    process.env.GIT_DIR = "/tmp/inherited-git-dir";
    process.env.GIT_WORK_TREE = "/tmp/inherited-work-tree";
    const execute: RunnerCommandExecutor = vi.fn(async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return {
        stdout: args.includes("rev-parse") ? `${commitSha}\n` : "",
        stderr: "",
      };
    });

    const workspace = await checkoutRunnerSource({
      job: job(),
      workspaceRoot: root,
      execute,
    });

    expect(workspace).toMatch(new RegExp(`${job().runId}-${job().executionAttemptId}-`, "u"));
    const fetchCall = calls.find((call) => call.args.includes("fetch"));
    expect(fetchCall?.args.slice(-2)).toEqual(["origin", commitSha]);
    const remoteAdd = calls.find((call) => call.args.includes("remote") && call.args.includes("add"));
    expect(remoteAdd?.args.at(-1)).toBe("https://github.com/octo-org/private-board.git");
    expect(calls.some((call) => call.args.includes("--detach") && call.args.includes("FETCH_HEAD"))).toBe(true);
    expect(calls.some((call) => call.args.includes("remove") && call.args.includes("origin"))).toBe(true);
    for (const call of calls) {
      expect(call.command).toBe("git");
      expect(call.args.slice(0, 4)).toEqual(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"]);
      expect(call.env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(call.env.GIT_DIR).toBeUndefined();
      expect(call.env.GIT_WORK_TREE).toBeUndefined();
    }
  });

  it("uses a customer-controlled bare mirror when configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-source-"));
    const mirror = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-mirror-"));
    roots.push(root, mirror);
    const calls: readonly string[][] = [];
    const mutableCalls = calls as string[][];
    const execute: RunnerCommandExecutor = async (_command, args) => {
      mutableCalls.push([...args]);
      return { stdout: args.includes("rev-parse") ? commitSha : "", stderr: "" };
    };

    await checkoutRunnerSource({ job: job(), workspaceRoot: root, repositoryMirrorRoot: mirror, execute });

    const remoteAdd = mutableCalls.find((args) => args.includes("remote") && args.includes("add"));
    expect(remoteAdd?.at(-1)).toBe(path.join(mirror, "octo-org", "private-board.git"));
  });

  it("rejects broker source assignments before creating a workspace or running Git", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-source-"));
    roots.push(root);
    const execute = vi.fn<RunnerCommandExecutor>();

    await expect(checkoutRunnerSource({ job: job("broker"), workspaceRoot: root, execute })).rejects.toThrow(
      /customer_checkout/u,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when the checked-out SHA differs from the assignment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-source-"));
    roots.push(root);
    const execute: RunnerCommandExecutor = async (_command, args) => ({
      stdout: args.includes("rev-parse") ? `${"b".repeat(40)}\n` : "",
      stderr: "",
    });

    await expect(checkoutRunnerSource({ job: job(), workspaceRoot: root, execute })).rejects.toThrow(
      /did not match the assigned commit/u,
    );
    await expect(readdir(root)).resolves.toEqual([]);
  });
});
