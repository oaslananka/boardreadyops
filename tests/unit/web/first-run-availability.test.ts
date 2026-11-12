import { describe, expect, it } from "vitest";
import { firstRunAvailability } from "../../../apps/web/lib/first-run-availability.js";
import type { RepositoryGroup } from "../../../apps/web/lib/repository-dashboard.js";

const groups = [
  {
    accountLogin: "acme",
    repositories: [
      { id: "repo-a", owner: "acme", name: "pcb-a" },
      { id: "repo-b", owner: "acme", name: "pcb-b" },
      { id: "repo-reviewed", owner: "acme", name: "reviewed", latestRunId: "run-1" },
    ],
  },
] as unknown as RepositoryGroup[];

describe("viewer-scoped first-run availability", () => {
  it("keeps gated repositories distinct from recorded runs and never invents a hosted result", () => {
    const result = firstRunAvailability(groups, { BOARDREADYOPS_RELEASE_REPOSITORIES: "" });
    expect(result).toMatchObject({ withoutRuns: 2, gated: 2, eligible: 0 });
    expect([...result.gatedRepositoryIds]).toEqual(["repo-a", "repo-b"]);
    expect(result.firstEnabledRepositoryId).toBeUndefined();
  });

  it("selects only a viewer-authorized eligible repository in a mixed rollout", () => {
    const result = firstRunAvailability(groups, { BOARDREADYOPS_RELEASE_REPOSITORIES: "acme/pcb-b" });
    expect(result).toMatchObject({ withoutRuns: 2, gated: 1, eligible: 1 });
    expect([...result.gatedRepositoryIds]).toEqual(["repo-a"]);
    expect(result.firstEnabledRepositoryId).toBe("repo-b");
  });

  it("allows hosted next steps only when the current rollout policy enables them", () => {
    const result = firstRunAvailability(groups, { BOARDREADYOPS_RELEASE_REPOSITORIES: "all" });
    expect(result).toMatchObject({ withoutRuns: 2, gated: 0, eligible: 2 });
    expect(result.firstEnabledRepositoryId).toBe("repo-a");
  });
});
