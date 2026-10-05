import type {
  EffectivePolicyProvenance,
  PolicyDryRunResult,
  PolicyFieldSource,
  ReviewPolicy,
} from "@boardreadyops/contracts";

export type PolicyLayer = "organization" | "team" | "repository" | "exception";

/**
 * Resolves effective policy via inheritance: org -> team -> repo -> exception.
 * Later layers override earlier ones where defined.
 */
export function resolveEffectivePolicy(input: {
  organization: ReviewPolicy | null;
  team: ReviewPolicy | null;
  repository: ReviewPolicy | null;
  exception: ReviewPolicy | null;
}): {
  effective: ReviewPolicy | null;
  sourceLayer: PolicyLayer | null;
  warnings: string[];
  provenance: EffectivePolicyProvenance | null;
} {
  const layers: Array<{ layer: PolicyLayer; policy: ReviewPolicy | null }> = [
    { layer: "organization", policy: input.organization },
    { layer: "team", policy: input.team },
    { layer: "repository", policy: input.repository },
    { layer: "exception", policy: input.exception },
  ];
  let effective: ReviewPolicy | null = null;
  let sourceLayer: PolicyLayer | null = null;
  let provenance: EffectivePolicyProvenance | null = null;
  const warnings: string[] = [];

  const sourceFor = (layer: PolicyLayer, policy: ReviewPolicy): PolicyFieldSource => ({
    layer,
    policyId: policy.id,
    policyName: policy.name,
  });

  for (const { layer, policy } of layers) {
    if (!policy) continue;
    const source = sourceFor(layer, policy);

    if (!effective) {
      effective = policy;
      sourceLayer = layer;
      provenance = {
        requiredChecklist: source,
        requiredRoles: source,
        severityGate: policy.severityGate === undefined ? null : source,
        requireEvidencePack: source,
        requireExternalReview: source,
      };
      continue;
    }

    const overriddenFields: string[] = [];
    const next: ReviewPolicy = { ...effective };
    if (!provenance) throw new Error("effective policy provenance invariant violated");

    if (policy.requiredChecklist.length > 0) {
      next.requiredChecklist = policy.requiredChecklist;
      provenance.requiredChecklist = source;
      overriddenFields.push("requiredChecklist");
    }
    if (policy.requiredRoles.length > 0) {
      next.requiredRoles = policy.requiredRoles;
      provenance.requiredRoles = source;
      overriddenFields.push("requiredRoles");
    }
    if (policy.severityGate !== undefined) {
      next.severityGate = policy.severityGate;
      provenance.severityGate = source;
      overriddenFields.push("severityGate");
    }
    if (policy.requireEvidencePack && !effective.requireEvidencePack) {
      next.requireEvidencePack = true;
      provenance.requireEvidencePack = source;
      overriddenFields.push("requireEvidencePack");
    }
    if (policy.requireExternalReview && !effective.requireExternalReview) {
      next.requireExternalReview = true;
      provenance.requireExternalReview = source;
      overriddenFields.push("requireExternalReview");
    }

    if (overriddenFields.length === 0) continue;

    effective = next;
    sourceLayer = layer;
    warnings.push(`Policy from ${layer} overrides ${overriddenFields.join(", ")} from inherited policy.`);
  }

  return { effective, sourceLayer, warnings, provenance };
}

export function dryRunPolicyImpact(input: {
  existingReviewsCount: number;
  repositoriesCount: number;
  newPolicy: ReviewPolicy;
  previousPolicy: ReviewPolicy | null;
}): PolicyDryRunResult {
  const severityTightened =
    input.previousPolicy?.severityGate !== input.newPolicy.severityGate && Boolean(input.newPolicy.severityGate);
  const checklistAdded =
    input.newPolicy.requiredChecklist.length > (input.previousPolicy?.requiredChecklist.length ?? 0);
  const blockers = (severityTightened ? 1 : 0) + (checklistAdded ? 1 : 0);
  return {
    affectedRepositories: input.repositoriesCount,
    affectedReviews: input.existingReviewsCount,
    blockersIntroduced: blockers,
    warnings: blockers > 0 ? ["New policy may block existing open reviews"] : [],
  };
}
