import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateCleanRoomRebuild,
  hashDistFiles,
  runCleanRoomRebuild,
} from "../../../scripts/verify-reproducible-build.mjs";

describe("evaluateCleanRoomRebuild", () => {
  it("passes when both digests match", () => {
    const result = evaluateCleanRoomRebuild({ sourceDigest: "abc", cleanRoomDigest: "abc" });
    expect(result.passed).toBe(true);
  });

  it("fails when digests differ", () => {
    const result = evaluateCleanRoomRebuild({ sourceDigest: "abc", cleanRoomDigest: "def" });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("digest mismatch");
  });

  it("fails when the source digest is missing", () => {
    const result = evaluateCleanRoomRebuild({ sourceDigest: "", cleanRoomDigest: "def" });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("source dist digest");
  });

  it("fails when the clean-room digest is missing", () => {
    const result = evaluateCleanRoomRebuild({ sourceDigest: "abc", cleanRoomDigest: "" });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("clean-room dist digest");
  });
});

describe("hashDistFiles", () => {
  it("hashes the action and cli bundles together", async () => {
    const readFileImpl = vi.fn(async (path: string) =>
      Buffer.from(path.includes("action") ? "action-bytes" : "cli-bytes"),
    );
    const digest = await hashDistFiles("/root", readFileImpl as never);
    expect(readFileImpl).toHaveBeenCalledWith(join("/root", "dist/action/index.cjs"));
    expect(readFileImpl).toHaveBeenCalledWith(join("/root", "dist/cli/index.cjs"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

const NODE = "/fake-node";
const PNPM_CLI = "/fake-pnpm-cli.js";

describe("runCleanRoomRebuild", () => {
  function fakeExec() {
    return vi.fn((command: string, args: string[], options: { cwd: string }) => {
      if (command === "git" && args[0] === "status") return { stdout: "", stderr: "" };
      if (command === "git" && args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
      if (command === "git" && args[0] === "worktree") return { stdout: "", stderr: "" };
      if (command === NODE && args[0] === PNPM_CLI) return { stdout: "", stderr: "" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")} in ${options.cwd}`);
    });
  }

  function fakeReadFile(distBytes: { workdir: string; root: string }) {
    return vi.fn(async (path: string) => {
      const label = path.includes("workdir") ? distBytes.workdir : distBytes.root;
      const file = path.includes("action") ? "action" : "cli";
      return Buffer.from(`${label}:${file}`);
    });
  }

  it("rejects a dirty working tree without touching the filesystem or spawning a build", async () => {
    const execImpl = vi.fn(() => ({ stdout: " M src/foo.ts\n", stderr: "" }));
    const mkdtempImpl = vi.fn();
    await expect(
      runCleanRoomRebuild({
        root: "/root",
        execImpl: execImpl as never,
        mkdtempImpl: mkdtempImpl as never,
        pnpmCli: PNPM_CLI,
        nodeExecutable: NODE,
      }),
    ).rejects.toThrow("uncommitted changes");
    expect(mkdtempImpl).not.toHaveBeenCalled();
  });

  it("requires npm_execpath to be resolvable", async () => {
    // An empty string (not undefined) is required here: default-parameter destructuring falls
    // back to process.env.npm_execpath for an explicit `undefined`, same as omitting the option.
    const execImpl = vi.fn(() => {
      throw new Error("execImpl should not be called before the npm_execpath guard");
    });
    await expect(runCleanRoomRebuild({ root: "/root", pnpmCli: "", execImpl: execImpl as never })).rejects.toThrow(
      "npm_execpath",
    );
    expect(execImpl).not.toHaveBeenCalled();
  });

  it("reports a pass when the clean-room and source builds produce identical bytes", async () => {
    const execImpl = fakeExec();
    const mkdtempImpl = vi.fn(async () => "/workdir");
    const rmImpl = vi.fn(async () => undefined);
    const readFileImpl = fakeReadFile({ workdir: "same", root: "same" });

    const result = await runCleanRoomRebuild({
      root: "/root",
      execImpl: execImpl as never,
      mkdtempImpl: mkdtempImpl as never,
      rmImpl: rmImpl as never,
      readFileImpl: readFileImpl as never,
      pnpmCli: PNPM_CLI,
      nodeExecutable: NODE,
    });

    expect(result.passed).toBe(true);
    expect(result.commit).toBe("deadbeef");
    expect(result.sourceDigest).toBe(result.cleanRoomDigest);
    expect(execImpl).toHaveBeenCalledWith("git", ["worktree", "add", "--detach", "--force", "/workdir", "deadbeef"], {
      cwd: "/root",
    });
    expect(execImpl).toHaveBeenCalledWith("git", ["worktree", "remove", "--force", "/workdir"], {
      cwd: "/root",
      allowFailure: true,
    });
    expect(rmImpl).toHaveBeenCalledWith("/workdir", { recursive: true, force: true });
  });

  it("reports a failure when the clean-room build differs from the source build", async () => {
    const execImpl = fakeExec();
    const mkdtempImpl = vi.fn(async () => "/workdir");
    const rmImpl = vi.fn(async () => undefined);
    const readFileImpl = fakeReadFile({ workdir: "different", root: "same" });

    const result = await runCleanRoomRebuild({
      root: "/root",
      execImpl: execImpl as never,
      mkdtempImpl: mkdtempImpl as never,
      rmImpl: rmImpl as never,
      readFileImpl: readFileImpl as never,
      pnpmCli: PNPM_CLI,
      nodeExecutable: NODE,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("digest mismatch");
    expect(rmImpl).toHaveBeenCalledWith("/workdir", { recursive: true, force: true });
  });

  it("still cleans up the temp worktree when the clean-room build throws", async () => {
    const execImpl = vi.fn((command: string, args: string[]) => {
      if (command === "git" && args[0] === "status") return { stdout: "", stderr: "" };
      if (command === "git" && args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
      if (command === "git" && args[0] === "worktree" && args[1] === "add") return { stdout: "", stderr: "" };
      if (command === NODE && args[1] === "install") return { stdout: "", stderr: "" };
      if (command === NODE && args[1] === "run" && args[2] === "build") throw new Error("build failed");
      if (command === "git" && args[0] === "worktree" && args[1] === "remove") return { stdout: "", stderr: "" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    });
    const mkdtempImpl = vi.fn(async () => "/workdir");
    const rmImpl = vi.fn(async () => undefined);

    await expect(
      runCleanRoomRebuild({
        root: "/root",
        execImpl: execImpl as never,
        mkdtempImpl: mkdtempImpl as never,
        rmImpl: rmImpl as never,
        pnpmCli: PNPM_CLI,
        nodeExecutable: NODE,
      }),
    ).rejects.toThrow("build failed");

    expect(execImpl).toHaveBeenCalledWith("git", ["worktree", "remove", "--force", "/workdir"], {
      cwd: "/root",
      allowFailure: true,
    });
    expect(rmImpl).toHaveBeenCalledWith("/workdir", { recursive: true, force: true });
  });
});
