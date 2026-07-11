import { describe, expect, it } from "vitest";
import { runnerDispatchInputs, safeModeInputs } from "../../../apps/web/lib/runner-client.js";
import type { EnqueueReleaseRunInput } from "../../../packages/cloud-core/src/lifecycle-executor.js";

const action: EnqueueReleaseRunInput = {
  type: "release_run.enqueue",
  installation: { id: 12345 },
  repository: {
    id: 98765,
    owner: "octo-org",
    name: "hardware-board",
    fullName: "octo-org/hardware-board",
    private: true,
  },
  pullRequestNumber: 42,
  ref: "feature/ready",
  commitSha: "0123456789abcdef",
  triggerKind: "pr",
};

describe("runner workflow dispatch binding", () => {
  it("binds workflow inputs and callback URL to the execution attempt", () => {
    const previousPublicUrl = process.env.BOARDREADYOPS_PUBLIC_URL;
    process.env.BOARDREADYOPS_PUBLIC_URL = "https://boardreadyops.test/";

    try {
      expect(
        runnerDispatchInputs({
          action,
          runId: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
          idempotencyKey: "98765:42:0123456789abcdef",
          githubCheckRunId: 555,
          executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
        }),
      ).toEqual({
        run_id: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
        execution_attempt_id: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
        target: "octo-org/hardware-board",
        head_sha: "0123456789abcdef",
        result_url:
          "https://boardreadyops.test/api/v1/runs/result?run_id=5dc4193b-5c7e-4df8-b86f-e4d3266fc22d&attempt_id=7559e99b-4998-4e02-a94a-7a7a4686ae11",
        safe_mode: "false",
        safe_mode_reasons: "",
      });
    } finally {
      if (previousPublicUrl === undefined) {
        delete process.env.BOARDREADYOPS_PUBLIC_URL;
      } else {
        process.env.BOARDREADYOPS_PUBLIC_URL = previousPublicUrl;
      }
    }
  });
});

describe("runner workflow safe-mode inputs", () => {
  it("uses an explicit false value when safe mode is absent", () => {
    expect(safeModeInputs(action)).toEqual({
      safe_mode: "false",
      safe_mode_reasons: "",
    });
  });

  it("deduplicates and orders known safe-mode reasons", () => {
    expect(
      safeModeInputs({
        ...action,
        safeMode: {
          enabled: true,
          reasons: ["private-repository", "draft-pull-request", "private-repository", "fork-pull-request"],
        },
      }),
    ).toEqual({
      safe_mode: "true",
      safe_mode_reasons: "draft-pull-request,fork-pull-request,private-repository",
    });
  });

  it("rejects unknown safe-mode reasons", () => {
    expect(() =>
      safeModeInputs({
        ...action,
        safeMode: {
          enabled: true,
          reasons: ["private-repository", "unknown-reason" as never],
        },
      }),
    ).toThrow("unsupported runner safe-mode reason");
  });

  it("rejects enabled safe mode without a reason", () => {
    expect(() =>
      safeModeInputs({
        ...action,
        safeMode: { enabled: true, reasons: [] },
      }),
    ).toThrow("requires at least one reason");
  });

  it("rejects reasons when safe mode is disabled", () => {
    expect(() =>
      safeModeInputs({
        ...action,
        safeMode: { enabled: false, reasons: ["private-repository"] },
      }),
    ).toThrow("require safe mode to be enabled");
  });
});
