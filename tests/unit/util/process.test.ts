import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ProcessOptions, runProcess } from "../../../src/util/process.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runProcess cancellation", () => {
  it("waits for an active child to terminate before rejecting an aborted process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-process-abort-"));
    roots.push(root);
    const readyFile = path.join(root, "ready");
    const controller = new AbortController();
    const options = {
      timeoutMs: 1_200,
      signal: controller.signal,
    } as ProcessOptions & { signal: AbortSignal };
    const child = runProcess(
      process.execPath,
      [
        "-e",
        `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); require("node:fs").writeFileSync(${JSON.stringify(readyFile)}, "ready");`,
      ],
      options,
    );

    await waitForFile(readyFile);
    const abortedAt = Date.now();
    controller.abort();

    await expect(child).rejects.toMatchObject({ name: "AbortError" });
    if (process.platform !== "win32") {
      expect(Date.now() - abortedAt).toBeGreaterThanOrEqual(350);
    }
  }, 5_000);

  it("preserves timeout results while terminating an unresponsive child", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
      { timeoutMs: 50 },
    );

    expect(result).toMatchObject({ code: null, timedOut: true });
  }, 2_000);

  it("preserves spawn-error results for missing commands", async () => {
    const result = await runProcess("boardreadyops-command-that-does-not-exist", [], { timeoutMs: 250 });

    expect(result.code).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("replaces the child's environment instead of inheriting process.env when env is supplied", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify({ marker: process.env.BOARDREADYOPS_TEST_MARKER ?? null }))"],
      { timeoutMs: 2_000, env: { BOARDREADYOPS_TEST_MARKER: "custom-env" } },
    );

    expect(JSON.parse(result.stdout)).toEqual({ marker: "custom-env" });
  });

  it("inherits process.env when no env override is supplied", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", 'process.stdout.write(JSON.stringify({ hasPath: typeof process.env.PATH === "string" }))'],
      { timeoutMs: 2_000 },
    );

    expect(JSON.parse(result.stdout)).toEqual({ hasPath: true });
  });
});

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`child did not create readiness marker: ${filePath}`);
}
