import { describe, expect, it } from "vitest";
import { runCli } from "../../../src/cli/index.js";

describe("runner CLI surface", () => {
  it("documents activation, one-shot, and service commands", async () => {
    const streams = captureStreams();

    expect(await runCli(["runner", "--help"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("issue-enrollment");
    expect(streams.stdoutText()).toContain("activate");
    expect(streams.stdoutText()).toContain("once");
    expect(streams.stdoutText()).toContain("serve");
    expect(streams.stdoutText()).toContain("customer-controlled self-hosted worker");
  });

  it("rejects runner intervals greater than five minutes as usage errors", async () => {
    const streams = captureStreams();

    expect(await runCli(["runner", "once", "--heartbeat-seconds", "301"], streams)).toBe(2);
    expect(streams.stderrText()).toContain("Runner interval must not exceed 300 seconds");
  });

  it("does not rewrite runner as the default run command", async () => {
    const streams = captureStreams();

    expect(await runCli(["runner", "once", "--help"], streams)).toBe(0);
    expect(streams.stdoutText()).toContain("claim and process at most one runner job");
    expect(streams.stdoutText()).toContain("--identity");
    expect(streams.stdoutText()).toContain("--repository-mirror-root");
  });
});

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
