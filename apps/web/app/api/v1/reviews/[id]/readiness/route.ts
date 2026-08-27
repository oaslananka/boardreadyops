import { evaluateReviewReadiness, resolveEffectivePolicy } from "@boardreadyops/cloud-core";
import type { ReviewPolicy } from "@boardreadyops/contracts";
import {
  FindingDecisionStore,
  ReviewApprovalStore,
  type ReviewPolicyRecord,
  ReviewPolicyStore,
  ReviewStore,
} from "@boardreadyops/db";
import { requireRepositoryApiContext } from "../../../../../../lib/api-auth.js";

export const runtime = "nodejs";

function toContractPolicy(record: ReviewPolicyRecord): ReviewPolicy {
  return {
    ...record,
    description: record.description ?? undefined,
    severityGate: record.severityGate ?? undefined,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await requireRepositoryApiContext(request, "reviews:read");
  if (ctx instanceof Response) return ctx;
  const { auth, repositoryId, executor } = ctx;

  const { id: reviewId } = await context.params;
  try {
    const reviewStore = new ReviewStore(executor);
    const review = await reviewStore.getReviewById(repositoryId, reviewId);
    if (!review) {
      return Response.json({ ok: false, error: "Review not found" }, { status: 404 });
    }

    const revisions = await reviewStore.listReviewRevisions(repositoryId, reviewId);
    const currentRevision = revisions.find((revision) => revision.id === review.currentRevisionId) ?? revisions[0];
    if (!currentRevision) {
      return Response.json({ ok: false, error: "Review has no revisions" }, { status: 409 });
    }

    const [findingRows, decisions, approvals, checklist] = await Promise.all([
      reviewStore.getFindingsForRun(repositoryId, review.headRunId),
      new FindingDecisionStore(executor).getLatestDecisionsByReviewId(reviewId),
      new ReviewApprovalStore(executor).listApprovalsForReview(reviewId),
      new ReviewApprovalStore(executor).listChecklistItems(reviewId),
    ]);

    const policyStore = new ReviewPolicyStore(executor);
    const tenantId = auth.actorId;
    const [organizationPolicy, repositoryPolicy] = await Promise.all([
      policyStore.getPolicy(tenantId, "organization", null),
      policyStore.getPolicy(tenantId, "repository", repositoryId),
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
      headEvidenceDigest: currentRevision.evidenceDigest,
      policy: effectivePolicy
        ? {
            requiredChecklist: effectivePolicy.requiredChecklist,
            requiredRoles: effectivePolicy.requiredRoles,
            severityGate: effectivePolicy.severityGate ?? null,
          }
        : null,
    });

    return Response.json({
      ok: true,
      readiness,
      effectivePolicy: effectivePolicy ? { ...effectivePolicy, sourceLayer } : null,
    });
  } finally {
    await executor.close();
  }
}
