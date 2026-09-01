import {
  evaluateReviewReadiness,
  type ReviewReadinessEvaluation,
  resolveEffectivePolicy,
} from "@boardreadyops/cloud-core";
import type { ReviewPolicy } from "@boardreadyops/contracts";
import {
  FindingDecisionStore,
  ReviewApprovalStore,
  type ReviewPolicyRecord,
  ReviewPolicyStore,
  ReviewStore,
} from "@boardreadyops/db";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";

function toContractPolicy(record: ReviewPolicyRecord): ReviewPolicy {
  return {
    ...record,
    description: record.description ?? undefined,
    severityGate: record.severityGate ?? undefined,
  };
}

/**
 * Single source of truth for review readiness: both the /readiness GET route
 * (what the UI renders) and the approval POST route (what actually gates an
 * approval) must call this, not reimplement blocker logic separately -- that
 * divergence is what let policy-configured blockers pass approval silently.
 */
export async function computeReviewReadiness(input: {
  executor: PgQueryExecutor;
  repositoryId: string;
  reviewId: string;
  headRunId: string;
  headEvidenceDigest: string;
  tenantId: string;
}): Promise<{
  readiness: ReviewReadinessEvaluation;
  effectivePolicy: (ReviewPolicy & { sourceLayer: "organization" | "team" | "repository" | "exception" }) | null;
}> {
  const [findingRows, decisions, approvals, checklist] = await Promise.all([
    new ReviewStore(input.executor).getFindingsForRun(input.repositoryId, input.headRunId),
    new FindingDecisionStore(input.executor).getLatestDecisionsByReviewId(input.reviewId),
    new ReviewApprovalStore(input.executor).listApprovalsForReview(input.reviewId),
    new ReviewApprovalStore(input.executor).listChecklistItems(input.reviewId),
  ]);

  const policyStore = new ReviewPolicyStore(input.executor);
  const [organizationPolicy, repositoryPolicy] = await Promise.all([
    policyStore.getPolicy(input.tenantId, "organization", null),
    policyStore.getPolicy(input.tenantId, "repository", input.repositoryId),
  ]);
  const { effective: effectivePolicy, sourceLayer } = resolveEffectivePolicy({
    organization: organizationPolicy ? toContractPolicy(organizationPolicy) : null,
    team: null,
    repository: repositoryPolicy ? toContractPolicy(repositoryPolicy) : null,
    exception: null,
  });

  const findings = findingRows
    .filter((row): row is typeof row & { fingerprint: string } => row.fingerprint !== null)
    .map((row) => ({
      fingerprint: row.fingerprint,
      severity: row.severity,
      ruleId: row.rule_id,
      path: row.path ?? "unknown",
    }));

  const readiness = evaluateReviewReadiness({
    findings,
    decisions,
    approvals,
    checklist,
    headEvidenceDigest: input.headEvidenceDigest,
    policy: effectivePolicy
      ? {
          requiredChecklist: effectivePolicy.requiredChecklist,
          requiredRoles: effectivePolicy.requiredRoles,
          severityGate: effectivePolicy.severityGate ?? null,
        }
      : null,
  });

  return {
    readiness,
    effectivePolicy: effectivePolicy && sourceLayer ? { ...effectivePolicy, sourceLayer } : null,
  };
}
