import { evaluateReviewReadiness, resolveEffectivePolicy } from "@boardreadyops/cloud-core";
import type { ReviewPolicy } from "@boardreadyops/contracts";
import {
  FindingDecisionStore,
  ReviewApprovalStore,
  type ReviewPolicyRecord,
  ReviewPolicyStore,
  ReviewStore,
} from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateApiRequest } from "../../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

function toContractPolicy(record: ReviewPolicyRecord): ReviewPolicy {
  return {
    ...record,
    description: record.description ?? undefined,
    severityGate: record.severityGate ?? undefined,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id: reviewId } = await context.params;
  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");
  if (!repositoryId) {
    return Response.json({ ok: false, error: "repositoryId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
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
