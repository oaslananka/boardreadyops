import { FindingDecisionStore, ReviewCollaborationStore, ReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateApiRequest } from "../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

interface AssignedFindingSummary {
  fingerprint: string;
  ruleId: string;
  severity: string;
  message: string;
  path: string | null;
  repositoryId: string;
  reviewId: string;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const collaborationStore = new ReviewCollaborationStore(executor);
    const reviewStore = new ReviewStore(executor);

    // Assignments are keyed by GitHub login, which is globally unique, so this cross-repository
    // lookup does not need a repositoryId to stay tenant-safe.
    const assignments = await collaborationStore.getAssignmentsForAssignee(auth.actorId);

    const assignedFindings: AssignedFindingSummary[] = [];
    const reviewCache = new Map<string, Awaited<ReturnType<typeof reviewStore.getReviewById>>>();
    for (const assignment of assignments) {
      const cacheKey = `${assignment.repositoryId}:${assignment.reviewId}`;
      let review = reviewCache.get(cacheKey);
      if (review === undefined) {
        review = await reviewStore.getReviewById(assignment.repositoryId, assignment.reviewId);
        reviewCache.set(cacheKey, review);
      }
      if (!review) continue;

      const [findingRows, decisions] = await Promise.all([
        reviewStore.getFindingsForRun(assignment.repositoryId, review.headRunId),
        new FindingDecisionStore(executor).getLatestDecisionsByReviewId(assignment.reviewId),
      ]);
      const findingRow = findingRows.find((row) => row.fingerprint === assignment.findingFingerprint);
      if (!findingRow) continue;

      const decision = decisions.get(assignment.findingFingerprint);
      const isOpen = !decision || decision.disposition === "open";
      if (!isOpen) continue;

      assignedFindings.push({
        fingerprint: assignment.findingFingerprint,
        ruleId: findingRow.rule_id,
        severity: findingRow.severity,
        message: findingRow.message,
        path: findingRow.path,
        repositoryId: assignment.repositoryId,
        reviewId: assignment.reviewId,
      });
    }

    let awaitingReviews: Awaited<ReturnType<typeof reviewStore.listReviews>>["reviews"] = [];
    let changesRequested: Awaited<ReturnType<typeof reviewStore.listReviews>>["reviews"] = [];
    if (repositoryId) {
      const [pending, requested] = await Promise.all([
        reviewStore.listReviews(repositoryId, { decision: "pending", limit: 50 }),
        reviewStore.listReviews(repositoryId, { decision: "changes_requested", limit: 50 }),
      ]);
      awaitingReviews = pending.reviews;
      changesRequested = requested.reviews;
    }

    return Response.json({
      ok: true,
      assignedFindings,
      awaitingReviews,
      changesRequested,
      scopedToRepository: repositoryId ?? null,
    });
  } finally {
    await executor.close();
  }
}
