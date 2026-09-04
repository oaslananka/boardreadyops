import { computeWdrrWeekly, isWdrrReady, type WdrrWeeklyCount } from "@boardreadyops/cloud-core";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { computeReviewReadiness } from "./review-readiness.js";
import type { UserSession } from "./user-session.js";

const windowDays = 90;
const maxReviewsPerWindow = 200;

const reviewWindowQuery = `
  select reviews.id as review_id,
         reviews.repository_id,
         reviews.created_at,
         review_revisions.base_run_id,
         review_revisions.head_run_id,
         review_revisions.evidence_digest,
         release_runs.status as head_run_status
    from reviews
    join repositories on repositories.id = reviews.repository_id
    join installations on installations.id = repositories.installation_id
    join review_revisions on review_revisions.id = reviews.current_revision_id
    left join release_runs on release_runs.id = review_revisions.head_run_id
   where installations.github_installation_id = any($1::bigint[])
     and repositories.disabled_at is null
     and installations.suspended_at is null
     and reviews.created_at >= $2
     and not exists (
       select 1 from github_marketplace_subscriptions
        where github_marketplace_subscriptions.status = 'canceled'
          and (
            github_marketplace_subscriptions.github_installation_id = installations.github_installation_id
            or (
              github_marketplace_subscriptions.github_installation_id is null
              and lower(github_marketplace_subscriptions.account_login) = lower(installations.account_login)
            )
          )
     )
   order by reviews.created_at desc
   limit $3`;

type ReviewReadinessResult = Awaited<ReturnType<typeof computeReviewReadiness>>;

export interface WdrrDashboardDependencies {
  evaluateReviewReadiness(input: {
    executor: PgQueryExecutor;
    repositoryId: string;
    reviewId: string;
    headRunId: string;
    headEvidenceDigest: string;
    tenantId: string;
  }): Promise<Pick<ReviewReadinessResult, "readiness">>;
}

const defaultDependencies: WdrrDashboardDependencies = {
  evaluateReviewReadiness: computeReviewReadiness,
};

function stringValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

const nullEvidenceDigest = "0".repeat(64);

/**
 * Weekly Decision-Ready Review counts for every repository the session's installations grant
 * access to -- the north-star metric this product tracks (docs/development/master-execution-status.md
 * defers WDRR reporting to real data instead of demo/empty state). Bounded to the last 90 days /
 * 200 reviews per load: each review calls the same `computeReviewReadiness` used by the review
 * detail page's own readiness gate, so this never invents a lighter-weight, potentially
 * diverging definition of "blockers dispositioned" or "required approval" -- ADR-documented as
 * the single source of truth for that logic.
 */
export async function loadViewerWdrrWeekly(
  session: UserSession | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: WdrrDashboardDependencies = defaultDependencies,
): Promise<WdrrWeeklyCount[]> {
  if (!session || session.installationIds.length === 0) return [];
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return [];

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await executor.query(reviewWindowQuery, [session.installationIds, since, maxReviewsPerWindow]);
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];

    const tenantId = session.login;
    const inputs = await Promise.all(
      rows.map(async (row) => {
        const reviewId = stringValue(row, "review_id");
        const repositoryId = stringValue(row, "repository_id");
        const headRunId = stringValue(row, "head_run_id");
        const baseRunId = stringValue(row, "base_run_id");
        const createdAt = stringValue(row, "created_at");
        const evidenceDigest = stringValue(row, "evidence_digest");
        const headRunStatus = stringValue(row, "head_run_status");
        if (!reviewId || !repositoryId || !headRunId || !createdAt || !evidenceDigest) return undefined;

        const { readiness } = await dependencies.evaluateReviewReadiness({
          executor,
          repositoryId,
          reviewId,
          headRunId,
          headEvidenceDigest: evidenceDigest,
          tenantId,
        });

        return {
          createdAt,
          wdrrReady: isWdrrReady({
            baseRunId,
            headRunId,
            requiredChecksComplete: headRunStatus === "completed",
            blockerFindingsResolved: !readiness.blockers.some((b) => b.type === "unresolved_finding"),
            requiredApprovalsPresent: !readiness.blockers.some(
              (b) =>
                b.type === "missing_approval" ||
                b.type === "changes_requested" ||
                b.type === "missing_required_approver_role",
            ),
            evidenceRecordProduced: evidenceDigest !== nullEvidenceDigest,
          }),
        };
      }),
    );

    return computeWdrrWeekly(
      inputs.filter((value): value is { createdAt: string; wdrrReady: boolean } => value !== undefined),
    );
  } finally {
    await executor.close();
  }
}
