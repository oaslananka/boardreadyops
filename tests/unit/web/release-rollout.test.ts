import { describe, expect, it } from "vitest";
import {
  releaseRepositoryDispatchAvailability,
  releaseRepositoryRolloutBlockedReason,
} from "../../../apps/web/lib/release-rollout.js";

describe("release repository rollout visibility", () => {
  it("allows a repository explicitly enabled by the deployment", () => {
    expect(
      releaseRepositoryDispatchAvailability("Acme/Power-Board", {
        BOARDREADYOPS_RELEASE_REPOSITORIES: "acme/power-board,acme/controller",
      }),
    ).toEqual({ enabled: true });
  });

  it("explains a rollout-disabled repository without exposing internal configuration", () => {
    const result = releaseRepositoryDispatchAvailability("acme/not-enabled", {
      BOARDREADYOPS_RELEASE_REPOSITORIES: "acme/power-board",
    });
    expect(result).toEqual({ enabled: false, reason: releaseRepositoryRolloutBlockedReason });
    if (result.enabled) throw new Error("expected a blocked rollout");
    expect(result.reason).toContain("not enabled");
    expect(result.reason).toContain("operator enables this repository");
    expect(result.reason).not.toContain("BOARDREADYOPS_RELEASE_REPOSITORIES");
  });

  it("fails closed when the deployment has no rollout policy", () => {
    expect(releaseRepositoryDispatchAvailability("acme/power-board", {})).toMatchObject({ enabled: false });
  });
});
