import { describe, expect, it } from "vitest";
import { safeModeInputs } from "../../../apps/web/lib/runner-client.js";
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
