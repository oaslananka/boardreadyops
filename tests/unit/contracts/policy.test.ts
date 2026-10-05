import { describe, expect, it } from "vitest";
import { effectivePolicySchema } from "../../../packages/contracts/src/policy.js";

const policy = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "octo-org",
  scope: "organization" as const,
  scopeId: null,
  name: "Org baseline",
  requiredChecklist: ["safety-review"],
  requiredRoles: ["hardware-lead"],
  severityGate: "high" as const,
  requireEvidencePack: true,
  requireExternalReview: false,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
};

describe("effective policy contract", () => {
  it("keeps provenance additive for older payloads", () => {
    const parsed = effectivePolicySchema.parse({
      policy,
      sourceLayer: "organization",
      inheritedFrom: null,
    });

    expect(parsed.provenance).toBeUndefined();
  });

  it("accepts field-level inheritance provenance for newer payloads", () => {
    const source = {
      layer: "organization" as const,
      policyId: policy.id,
      policyName: policy.name,
    };
    const parsed = effectivePolicySchema.parse({
      policy,
      sourceLayer: "repository",
      inheritedFrom: policy.id,
      provenance: {
        requiredChecklist: {
          layer: "repository",
          policyId: "rpol-repo",
          policyName: "Repository override",
        },
        requiredRoles: source,
        severityGate: source,
        requireEvidencePack: source,
        requireExternalReview: null,
      },
    });

    expect(parsed.provenance?.requiredChecklist).toMatchObject({
      layer: "repository",
      policyName: "Repository override",
    });
    expect(parsed.provenance?.requiredRoles).toEqual(source);
  });
});
