import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../../src/cli/index.js";

const fixtureRoot = path.resolve("examples/golden-demo");

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: {
      write(value: string) {
        stdout += value;
        return true;
      },
    } as NodeJS.WritableStream,
    stderr: {
      write(value: string) {
        stderr += value;
        return true;
      },
    } as NodeJS.WritableStream,
    stdoutText: () => stdout,
    stderrText: () => stderr,
  };
}

async function runFixture(fixture: "broken" | "fixed", extraArgs: string[] = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-cli-status-"));
  try {
    await fs.cp(path.join(fixtureRoot, fixture), dir, { recursive: true });
    const streams = captureStreams();
    const code = await runCli(["check", dir, ...extraArgs, "--no-annotations"], streams);
    return { code, stdout: streams.stdoutText(), stderr: streams.stderrText() };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("CLI preflight result wording", () => {
  it("does not imply fabrication readiness when a non-blocking check finds issues", async () => {
    const result = await runFixture("broken", ["--fail-on", "never"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("R1 is missing an MPN");
    expect(result.stderr).toContain("findings require review (non-blocking)");
    expect(result.stderr).not.toContain("Preflight Passed!");
  });

  it("uses singular wording when a non-blocking check finds one issue", async () => {
    const result = await runFixture("broken", ["--fail-on", "never", "--rule", "bom.missing-mpn"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("1 finding requires review (non-blocking)");
  });

  it("keeps a clean preflight success message", async () => {
    const result = await runFixture("fixed");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Preflight Passed!");
  });

  it("keeps failing exit codes and visible failure wording for blocking findings", async () => {
    const result = await runFixture("broken");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Preflight Failed!");
    expect(result.stderr).not.toContain("non-blocking");
  });
});
