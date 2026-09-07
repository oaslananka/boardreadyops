import { FindingDecisionStore, ReviewCollaborationStore, ReviewStore } from "@boardreadyops/db";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import type { UserSession } from "./user-session.js";

/**
 * The viewer's queue: findings assigned to them, plus the reviews still waiting on a decision.
 *
 * `GET /api/v1/me/work` and `/work` both read this, so the endpoint and the page cannot drift.
 * Before this existed the endpoint had no consumer at all and the page rendered fixtures
 * unconditionally.
 */

export type AssignedFinding = {
  fingerprint: string;
  ruleId: string;
  severity: string;
  message: string;
  path: string | null;
  repositoryId: string;
  reviewId: string;
};

/**
 * Assignments are keyed by GitHub login, which is globally unique, so this cross-repository
 * lookup stays tenant-safe without a repositoryId. Findings that already carry a disposition are
 * dropped: the queue is what still needs a decision.
 */
export async function loadAssignedFindings(executor: PgQueryExecutor, assignee: string): Promise<AssignedFinding[]> {
  const collaborationStore = new ReviewCollaborationStore(executor);
  const reviewStore = new ReviewStore(executor);
  const decisionStore = new FindingDecisionStore(executor);

  const assignments = await collaborationStore.getAssignmentsForAssignee(assignee);
  const assigned: AssignedFinding[] = [];
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
      decisionStore.getLatestDecisionsByReviewId(assignment.reviewId),
    ]);
    const findingRow = findingRows.find((row) => row.fingerprint === assignment.findingFingerprint);
    if (!findingRow) continue;

    const decision = decisions.get(assignment.findingFingerprint);
    if (decision && decision.disposition !== "open") continue;

    assigned.push({
      fingerprint: assignment.findingFingerprint,
      ruleId: findingRow.rule_id,
      severity: findingRow.severity,
      message: findingRow.message,
      path: findingRow.path,
      repositoryId: assignment.repositoryId,
      reviewId: assignment.reviewId,
    });
  }

  return assigned;
}

export type WorkQueue = {
  assignedFindings: readonly AssignedFinding[];
};

/**
 * The page-side entry point: opens its own connection, because a React Server Component has no
 * request-scoped executor to borrow the way an API route does.
 *
 * Returns an empty queue rather than throwing when the deployment has no database, so `/work`
 * renders its empty state instead of a 500 — the QA audit counts a 5xx as a P0.
 */
export async function loadViewerWorkQueue(
  session: UserSession | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<WorkQueue> {
  const connectionString = environment.DATABASE_URL;
  if (!session || !connectionString) return { assignedFindings: [] };

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    return { assignedFindings: await loadAssignedFindings(executor, session.login) };
  } finally {
    await executor.close();
  }
}
