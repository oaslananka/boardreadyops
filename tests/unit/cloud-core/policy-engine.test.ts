import type { ReviewPolicy } from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";
import { dryRunPolicyImpact, resolveEffectivePolicy } from "../../../packages/cloud-core/src/policy-engine.js";

function policy(overrides: Partial<ReviewPolicy> & Pick<ReviewPolicy, "scope" | "name">): ReviewPolicy {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    tenantId: "tenant-a",
    scopeId: null,
    requiredChecklist: [],
    requiredRoles: [],
    requireEvidencePack: false,
    requireExternalReview: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveEffectivePolicy", () => {
  it("falls back through org -> team -> repository -> exception, in that order", () => {
    const org = policy({ scope: "organization", name: "org-default", requiredChecklist: ["safety-review"] });

    const result = resolveEffectivePolicy({ organization: org, team: null, repository: null, exception: null });

    expect(result.sourceLayer).toBe("organization");
    expect(result.effective).toEqual(org);
    expect(result.provenance).toEqual({
      requiredChecklist: { layer: "organization", policyId: org.id, policyName: "org-default" },
      requiredRoles: { layer: "organization", policyId: org.id, policyName: "org-default" },
      severityGate: null,
      requireEvidencePack: { layer: "organization", policyId: org.id, policyName: "org-default" },
      requireExternalReview: { layer: "organization", policyId: org.id, policyName: "org-default" },
    });
    expect(result.warnings).toEqual([]);
  });

  it("returns no effective policy and no warnings when nothing is configured at any layer", () => {
    const result = resolveEffectivePolicy({ organization: null, team: null, repository: null, exception: null });
    expect(result.effective).toBeNull();
    expect(result.sourceLayer).toBeNull();
    expect(result.provenance).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("rejects cross-tenant policy inheritance even when both scopes and field values are valid", () => {
    const org = policy({ scope: "organization", name: "org-a", requiredChecklist: ["safety-review"] });
    const otherTenant = policy({
      scope: "repository",
      name: "repo-b",
      tenantId: "tenant-b",
      requiredChecklist: ["release-approved"],
    });
    expect(() =>
      resolveEffectivePolicy({ organization: org, team: null, repository: otherTenant, exception: null }),
    ).toThrow("Cross-tenant review policy inheritance rejected");
    expect(() =>
      resolveEffectivePolicy({ organization: null, team: null, repository: otherTenant, exception: null }),
    ).not.toThrow();
  });

  it("rejects a record in the wrong policy layer rather than laundering its scope provenance", () => {
    const repository = policy({ scope: "repository", name: "repo-policy" });
    expect(() =>
      resolveEffectivePolicy({ organization: repository, team: null, repository: null, exception: null }),
    ).toThrow("Review policy layer does not match its declared scope");
    const blankTenant = policy({ scope: "organization", name: "empty-tenant", tenantId: "" });
    expect(() =>
      resolveEffectivePolicy({ organization: blankTenant, team: null, repository: null, exception: null }),
    ).toThrow("Cross-tenant review policy inheritance rejected");
  });

  it("lets a repository-level override replace the organization default and records a warning", () => {
    const org = policy({ scope: "organization", name: "org-default", requiredChecklist: ["safety-review"] });
    const repo = policy({ scope: "repository", name: "repo-override", requiredChecklist: ["fab-checklist"] });

    const result = resolveEffectivePolicy({ organization: org, team: null, repository: repo, exception: null });

    expect(result.sourceLayer).toBe("repository");
    expect(result.effective?.requiredChecklist).toEqual(["fab-checklist"]);
    expect(result.provenance?.requiredChecklist).toMatchObject({
      layer: "repository",
      policyName: "repo-override",
    });
    expect(result.provenance?.requiredRoles).toMatchObject({
      layer: "organization",
      policyName: "org-default",
    });
    expect(result.warnings).toEqual(["Policy from repository overrides requiredChecklist from inherited policy."]);
  });

  it("keeps the prior layer's checklist when the override layer leaves it empty", () => {
    const org = policy({ scope: "organization", name: "org-default", requiredChecklist: ["safety-review"] });
    const team = policy({ scope: "team", name: "team-override", requiredChecklist: [] });

    const result = resolveEffectivePolicy({ organization: org, team, repository: null, exception: null });

    expect(result.effective?.requiredChecklist).toEqual(["safety-review"]);
    expect(result.sourceLayer).toBe("organization");
    expect(result.provenance?.requiredChecklist).toMatchObject({
      layer: "organization",
      policyName: "org-default",
    });
  });

  it("lets requireEvidencePack/requireExternalReview only turn on, never back off, across layers", () => {
    const org = policy({ scope: "organization", name: "org-default", requireEvidencePack: true });
    const repo = policy({ scope: "repository", name: "repo-override", requireEvidencePack: false });

    const result = resolveEffectivePolicy({ organization: org, team: null, repository: repo, exception: null });

    expect(result.effective?.requireEvidencePack).toBe(true);
    expect(result.provenance?.requireEvidencePack).toMatchObject({
      layer: "organization",
      policyName: "org-default",
    });
    expect(result.sourceLayer).toBe("organization");
  });

  it("attributes independently overridden fields to the layers that actually supplied them", () => {
    const org = policy({
      scope: "organization",
      name: "org-default",
      requiredChecklist: ["safety-review"],
      requiredRoles: ["hardware-lead"],
      severityGate: "high",
    });
    const repo = policy({
      scope: "repository",
      name: "repo-override",
      requiredChecklist: ["fab-checklist"],
      severityGate: "error",
    });

    const result = resolveEffectivePolicy({ organization: org, team: null, repository: repo, exception: null });

    expect(result.effective).toMatchObject({
      requiredChecklist: ["fab-checklist"],
      requiredRoles: ["hardware-lead"],
      severityGate: "error",
    });
    expect(result.provenance).toMatchObject({
      requiredChecklist: { layer: "repository", policyName: "repo-override" },
      requiredRoles: { layer: "organization", policyName: "org-default" },
      severityGate: { layer: "repository", policyName: "repo-override" },
    });
  });
});

describe("dryRunPolicyImpact", () => {
  it("reports no blockers when the new policy neither tightens severity nor adds checklist items", () => {
    const previousPolicy = policy({ scope: "organization", name: "current", severityGate: "high" });
    const newPolicy = policy({ scope: "organization", name: "current", severityGate: "high" });

    const result = dryRunPolicyImpact({
      existingReviewsCount: 12,
      repositoriesCount: 3,
      newPolicy,
      previousPolicy,
    });

    expect(result).toEqual({
      affectedRepositories: 3,
      affectedReviews: 12,
      blockersIntroduced: 0,
      warnings: [],
    });
  });

  it("flags a tightened severity gate as a blocker with a warning", () => {
    const previousPolicy = policy({ scope: "organization", name: "current" });
    const newPolicy = policy({ scope: "organization", name: "current", severityGate: "error" });

    const result = dryRunPolicyImpact({
      existingReviewsCount: 5,
      repositoriesCount: 1,
      newPolicy,
      previousPolicy,
    });

    expect(result.blockersIntroduced).toBe(1);
    expect(result.warnings).toEqual(["New policy may block existing open reviews"]);
  });

  it("flags an expanded required checklist as a blocker, and counts both blockers when severity also tightens", () => {
    const previousPolicy = policy({ scope: "organization", name: "current", requiredChecklist: ["a"] });
    const newPolicy = policy({
      scope: "organization",
      name: "current",
      requiredChecklist: ["a", "b"],
      severityGate: "medium",
    });

    const result = dryRunPolicyImpact({
      existingReviewsCount: 2,
      repositoriesCount: 1,
      newPolicy,
      previousPolicy,
    });

    expect(result.blockersIntroduced).toBe(2);
  });

  it("treats a first-ever policy (no previous policy) as introducing a fresh checklist blocker", () => {
    const newPolicy = policy({ scope: "organization", name: "first", requiredChecklist: ["a"] });

    const result = dryRunPolicyImpact({
      existingReviewsCount: 0,
      repositoriesCount: 1,
      newPolicy,
      previousPolicy: null,
    });

    expect(result.blockersIntroduced).toBe(1);
  });
});
