import { describe, expect, it, vi } from "vitest";
import { repositoryPlanTier, repositoryTenantId } from "../../../apps/web/app/api/v1/external-review-links/route.js";

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

describe("repositoryTenantId", () => {
  it("resolves the repository installation_id as tenant ID", async () => {
    const executor = fakeExecutor([{ installation_id: "inst-123" }]);
    await expect(repositoryTenantId(executor, "repo-1")).resolves.toBe("inst-123");
  });

  it("returns undefined when repository is not found", async () => {
    const executor = fakeExecutor([]);
    await expect(repositoryTenantId(executor, "repo-missing")).resolves.toBeUndefined();
  });
});
