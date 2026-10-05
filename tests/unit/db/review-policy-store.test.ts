import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import {
  type ReviewPolicyAuditEventRecord,
  type ReviewPolicyMutationActor,
  type ReviewPolicyRecord,
  ReviewPolicyStore,
} from "../../../packages/db/src/review-policy-store.js";

const actor: ReviewPolicyMutationActor = { githubUserId: 42, login: "octocat" };

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
    createdAt: "2026-10-05T03:00:00.000Z",
    updatedAt: "2026-10-05T03:00:00.000Z",
    ...overrides,
  };
}

function mockAuditEvent(overrides: Partial<ReviewPolicyAuditEventRecord> = {}): ReviewPolicyAuditEventRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "acme",
    policyId: "rpol_1",
    action: "update",
    scope: "organization",
    scopeId: null,
    actorGithubUserId: "42",
    actorLogin: "octocat",
    beforePolicy: mockPolicy(),
    afterPolicy: mockPolicy({ severityGate: "medium" }),
    createdAt: "2026-10-05T03:05:00.000Z",
    ...overrides,
  };
}

describe("ReviewPolicyStore", () => {
  it("creates a policy and its audit event in one statement", async () => {
    const record = mockPolicy();
    const query = vi.fn().mockResolvedValueOnce([record]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    const created = await store.createPolicy(
      {
        tenantId: "acme",
        scope: "organization",
        name: "Default org policy",
        requiredChecklist: ["Verify silk", "Check DFM"],
        requiredRoles: ["hardware-lead"],
        severityGate: "high",
        requireEvidencePack: true,
      },
      actor,
    );

    expect(created).toEqual(record);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO review_policies");
    expect(sql).toContain("INSERT INTO review_policy_audit_events");
    expect(sql).toContain("'create'");
    expect(sql).toContain("before_policy, after_policy");
    expect(params[6]).toBe(JSON.stringify(["Verify silk", "Check DFM"]));
    expect(params[7]).toBe(JSON.stringify(["hardware-lead"]));
    expect(params[11]).toBe(42);
    expect(params[12]).toBe("octocat");
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

  it("returns undefined from updatePolicy when the policy does not exist", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.updatePolicy("missing", { name: "x" }, actor)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("deletes a policy and writes the delete snapshot in the same statement", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: "rpol_1" }])
      .mockResolvedValueOnce([]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.deletePolicy("rpol_1", actor)).resolves.toBe(true);
    await expect(store.deletePolicy("missing", actor)).resolves.toBe(false);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM review_policies");
    expect(sql).toContain("INSERT INTO review_policy_audit_events");
    expect(sql).toContain("'delete'");
    expect(sql).toContain("NULL, NOW()");
    expect(params).toEqual(["rpol_1", 42, "octocat"]);
  });

  it("lists only one tenant policy history with a bounded limit", async () => {
    const event = mockAuditEvent();
    const query = vi.fn().mockResolvedValueOnce([event]);
    const store = new ReviewPolicyStore({ query } as unknown as SqlQueryExecutor);

    await expect(store.listAuditEvents("acme", "rpol_1", 9999)).resolves.toEqual([event]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM review_policy_audit_events");
    expect(sql).toContain("tenant_id = $1");
    expect(sql).toContain("policy_id = $2");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(params).toEqual(["acme", "rpol_1", 250]);
  });
});
