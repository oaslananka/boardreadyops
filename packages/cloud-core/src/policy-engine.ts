import type { PolicyDryRunResult, ReviewPolicy } from "@boardreadyops/contracts";

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
}): { effective: ReviewPolicy | null; sourceLayer: PolicyLayer | null; warnings: string[] } {
  const layers: Array<{ layer: PolicyLayer; policy: ReviewPolicy | null }> = [
    { layer: "organization", policy: input.organization },
    { layer: "team", policy: input.team },
    { layer: "repository", policy: input.repository },
    { layer: "exception", policy: input.exception },
  ];
  let effective: ReviewPolicy | null = null;
  let sourceLayer: PolicyLayer | null = null;
  const warnings: string[] = [];
  for (const { layer, policy } of layers) {
    if (!policy) continue;
    if (!effective) {
      effective = policy;
      sourceLayer = layer;
    } else {
      // Merge: later layer overrides non-empty fields
      effective = {
        ...(effective as Record<string, unknown>),
        requiredChecklist: policy.requiredChecklist.length > 0 ? policy.requiredChecklist : effective.requiredChecklist,
        requiredRoles: policy.requiredRoles.length > 0 ? policy.requiredRoles : effective.requiredRoles,
        severityGate: policy.severityGate ?? effective.severityGate,
        requireEvidencePack: policy.requireEvidencePack || effective.requireEvidencePack,
        requireExternalReview: policy.requireExternalReview || effective.requireExternalReview,
      } as ReviewPolicy;
      sourceLayer = layer;
      warnings.push(`Policy from ${layer} overrides ${effective.name}`);
    }
  }
  return { effective, sourceLayer, warnings };
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
