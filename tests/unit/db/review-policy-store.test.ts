import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { type ReviewPolicyRecord, ReviewPolicyStore } from "../../../packages/db/src/review-policy-store.js";

function mockPolicy(overrides: Partial<ReviewPolicyRecord> = {}): ReviewPolicyRecord {
  return {
    id: "rpol_1",
    tenantId: "acme",
    scope: "organization",
    scopeId: null,
    name: "Default org policy",
    description: null,
    requiredChecklist: ["Verify silk", "Check DFM"],
    requiredRoles: ["hardware-lead"],
    severityGate: "high",
    requireEvidencePack: true,
    requireExternalReview: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ReviewPolicyStore", () => {
  it("creates a policy, serializing checklist/role arrays as jsonb parameters", async () => {
    const record = mockPolicy();
    const query = vi.fn().mockResolvedValueOnce([record]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    const created = await store.createPolicy({
      tenantId: "acme",
      scope: "organization",
      name: "Default org policy",
      requiredChecklist: ["Verify silk", "Check DFM"],
      requiredRoles: ["hardware-lead"],
      severityGate: "high",
      requireEvidencePack: true,
    });

    expect(created).toEqual(record);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO review_policies");
    expect(params[6]).toBe(JSON.stringify(["Verify silk", "Check DFM"]));
    expect(params[7]).toBe(JSON.stringify(["hardware-lead"]));
  });

  it("looks up a policy by tenant/scope/scopeId using null-safe scope matching", async () => {
    const record = mockPolicy({ scope: "repository", scopeId: "repo-1" });
    const query = vi.fn().mockResolvedValueOnce([record]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    const found = await store.getPolicy("acme", "repository", "repo-1");

    expect(found).toEqual(record);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("IS NOT DISTINCT FROM");
    expect(params).toEqual(["acme", "repository", "repo-1"]);
  });

  it("returns undefined when no policy exists at that scope", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.getPolicy("acme", "organization", null)).resolves.toBeUndefined();
  });

  it("updates a policy, merging unspecified fields from the existing record", async () => {
    const existing = mockPolicy();
    const updated = mockPolicy({ severityGate: "medium", requiredRoles: ["hardware-lead", "safety-reviewer"] });
    const query = vi
      .fn()
      .mockResolvedValueOnce([existing]) // getPolicyById inside updatePolicy
      .mockResolvedValueOnce([updated]); // the UPDATE ... RETURNING
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    const result = await store.updatePolicy("rpol_1", {
      severityGate: "medium",
      requiredRoles: ["hardware-lead", "safety-reviewer"],
    });

    expect(result).toEqual(updated);
    const [, updateParams] = query.mock.calls[1] as [string, unknown[]];
    expect(updateParams[3]).toBe(JSON.stringify(existing.requiredChecklist));
    expect(updateParams[5]).toBe("medium");
  });

  it("returns undefined from updatePolicy when the policy does not exist", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.updatePolicy("missing", { name: "x" })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("deletePolicy reports whether a row was actually removed", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: "rpol_1" }])
      .mockResolvedValueOnce([]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.deletePolicy("rpol_1")).resolves.toBe(true);
    await expect(store.deletePolicy("missing")).resolves.toBe(false);
  });
});
