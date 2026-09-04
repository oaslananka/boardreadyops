import { describe, expect, it, vi } from "vitest";
import { repositoryPlanTier } from "../../../apps/web/app/api/v1/external-review-links/route.js";

function fakeExecutor(rows: readonly Record<string, unknown>[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Parameters<typeof repositoryPlanTier>[0];
}

describe("repositoryPlanTier", () => {
  it("resolves the installation's plan tier for the given repository", async () => {
    const executor = fakeExecutor([{ plan_tier: "business" }]);
    await expect(repositoryPlanTier(executor, "repo-1")).resolves.toBe("business");
  });

  it("defaults to free when the repository has no matching installation row", async () => {
    const executor = fakeExecutor([]);
    await expect(repositoryPlanTier(executor, "repo-missing")).resolves.toBe("free");
  });

  it("defaults to free when the stored plan_tier is unrecognized", async () => {
    const executor = fakeExecutor([{ plan_tier: "not-a-real-tier" }]);
    await expect(repositoryPlanTier(executor, "repo-1")).resolves.toBe("free");
  });
});
