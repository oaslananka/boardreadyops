import { describe, expect, it, vi } from "vitest";
import type { CliRunner, CliRunResult } from "../../../packages/mcp-server/src/cli-runner.js";
import { runCheckTool, runPlanTool, runVerifyBundleTool } from "../../../packages/mcp-server/src/tools.js";

function fakeRunner(result: Partial<CliRunResult>): CliRunner {
  return vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", ...result });
}

describe("runCheckTool", () => {
  it("builds the check command with format json and returns the parsed result", async () => {
    const runResult = { schemaVersion: 1, summary: { total: 0, failed: false }, exitCode: 0 };
    const runner = fakeRunner({ stdout: `${JSON.stringify(runResult)}\n`, exitCode: 0 });

    const result = await runCheckTool({ path: "/board" }, runner);

    expect(runner).toHaveBeenCalledWith(["check", "--format", "json", "/board"]);
    expect(result).toEqual({ ok: true, result: runResult });
  });

  it("passes through config and failOn options", async () => {
    const runner = fakeRunner({ stdout: "{}\n" });

    await runCheckTool({ path: "/board", config: "custom.yml", failOn: "critical" }, runner);

    expect(runner).toHaveBeenCalledWith([
      "check",
      "--format",
      "json",
      "--config",
      "custom.yml",
      "--fail-on",
      "critical",
      "/board",
    ]);
  });

  it("defaults path to the current directory when omitted", async () => {
    const runner = fakeRunner({ stdout: "{}\n" });

    await runCheckTool({}, runner);

    expect(runner).toHaveBeenCalledWith(["check", "--format", "json", "."]);
  });

  it("still parses the result for exit code 1 (blocking findings is a valid outcome, not a tool error)", async () => {
    const runResult = { summary: { failed: true }, exitCode: 1 };
    const runner = fakeRunner({ stdout: `${JSON.stringify(runResult)}\n`, exitCode: 1 });

    const result = await runCheckTool({ path: "/board" }, runner);

    expect(result).toEqual({ ok: true, result: runResult });
  });

  it("returns a tool error when stdout is not valid JSON (genuine CLI execution failure)", async () => {
    const runner = fakeRunner({ stdout: "", stderr: "kicad-cli not found\n", exitCode: 3 });

    const result = await runCheckTool({ path: "/board" }, runner);

    expect(result).toEqual({ ok: false, error: "kicad-cli not found", exitCode: 3 });
  });

  it("falls back to a generic error message when stderr is empty too", async () => {
    const runner = fakeRunner({ stdout: "not json", stderr: "", exitCode: 2 });

    const result = await runCheckTool({ path: "/board" }, runner);

    expect(result).toEqual({
      ok: false,
      error: "boardreadyops check exited with code 2 and no parseable output",
      exitCode: 2,
    });
  });
});

describe("runPlanTool", () => {
  it("builds the plan command with format json (plan always emits JSON, no explicit --format flag needed)", async () => {
    const plan = { schemaVersion: 1, nextActions: [] };
    const runner = fakeRunner({ stdout: `${JSON.stringify(plan)}\n` });

    const result = await runPlanTool({ path: "/board", failOn: "high" }, runner);

    expect(runner).toHaveBeenCalledWith(["plan", "--fail-on", "high", "/board"]);
    expect(result).toEqual({ ok: true, result: plan });
  });
});

describe("runVerifyBundleTool", () => {
  it("builds the release verify command with format json and an optional trusted public key", async () => {
    const verification = { ok: true, checked: 3, signature: { present: true, ok: true } };
    const runner = fakeRunner({ stdout: `${JSON.stringify(verification)}\n` });

    const result = await runVerifyBundleTool({ bundleDir: "/build/release", trustedKey: "/keys/pub.pem" }, runner);

    expect(runner).toHaveBeenCalledWith([
      "release",
      "verify",
      "--format",
      "json",
      "--public-key",
      "/keys/pub.pem",
      "/build/release",
    ]);
    expect(result).toEqual({ ok: true, result: verification });
  });

  it("omits --public-key when no trusted key is provided", async () => {
    const runner = fakeRunner({ stdout: "{}\n" });

    await runVerifyBundleTool({ bundleDir: "/build/release" }, runner);

    expect(runner).toHaveBeenCalledWith(["release", "verify", "--format", "json", "/build/release"]);
  });
});
