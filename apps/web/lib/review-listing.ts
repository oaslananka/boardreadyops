import { CloudRuntimeConfigurationError, resolveCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import type { DemoReview } from "./demo-data.js";
import type { UserSession } from "./user-session.js";

/**
 * Cross-repository review listing for a signed-in viewer.
 *
 * `GET /api/v1/reviews` cannot be reused: it resolves a single `repositoryId` before it queries,
 * so it can only ever answer "reviews for this repository". A viewer's queue spans every
 * repository their installations reach, which is a different query — the same shape
 * `lib/run-listing.ts` already implements for runs, down to the tenant-scoping WHERE clause.
 *
 * The fixture branch is not a feature flag. It is the same condition `loadServerReview` uses, so
 * the list and the detail page can never disagree about which reviews exist — the bug the
 * 2026-09-01 audit recorded as P0-03, where a deployment with Postgres listed a fixture review
 * that then 404'd when opened.
 */

export type ReviewListEntry = {
  id: string;
  repositoryId: string;
  repositoryName: string;
  pullRequestNumber: number | undefined;
  title: string;
  status: string;
  decision: string;
  createdBy: string;
  updatedAt: string;
};

export type ReviewListingResult =
  | { state: "signed-out" }
  | { state: "fixtures"; reviews: readonly DemoReview[] }
  | { state: "ok"; reviews: readonly ReviewListEntry[]; next: string | undefined };

const defaultPageSize = 50;

/**
 * Whether this deployment serves the bundled demo reviews.
 *
 * True whenever cloud persistence is not Postgres — an unconfigured local run, the E2E suite, or
 * a preview deployment. Exported so the detail loader and every listing share one answer.
 */
export function reviewFixturesEnabled(): boolean {
  try {
    return resolveCloudPersistenceConfiguration().mode !== "postgres";
  } catch (error) {
    if (error instanceof CloudRuntimeConfigurationError && error.code === "missing-database-url") return true;
    throw error;
  }
}

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

const reviewListingQuery = `
  select reviews.id,
         reviews.repository_id,
         repositories.owner,
         repositories.name as repository_name,
         reviews.pull_request_number,
         reviews.title,
         reviews.status,
         reviews.decision,
         reviews.created_by,
         reviews.updated_at
    from reviews
    join repositories on repositories.id = reviews.repository_id
    join installations on installations.id = repositories.installation_id
   where installations.github_installation_id = any($1::bigint[])
     and repositories.disabled_at is null
     and installations.suspended_at is null
     and not exists (
       select 1
         from github_marketplace_subscriptions
        where github_marketplace_subscriptions.status = 'canceled'
          and (
            github_marketplace_subscriptions.github_installation_id = installations.github_installation_id
            or (
              github_marketplace_subscriptions.github_installation_id is null
              and lower(github_marketplace_subscriptions.account_login) = lower(installations.account_login)
            )
          )
     )
   order by reviews.updated_at desc, reviews.id desc
   limit $2`;

export async function loadViewerReviews(
  session: UserSession | undefined,
  options: { limit?: number; fixtures?: readonly DemoReview[] } = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ReviewListingResult> {
  if (reviewFixturesEnabled()) {
    return { state: "fixtures", reviews: options.fixtures ?? [] };
  }
  if (!session || session.installationIds.length === 0) return { state: "signed-out" };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "signed-out" };

  const limit = Math.min(Math.max(options.limit ?? defaultPageSize, 1), 200);
  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const result = await executor.query(reviewListingQuery, [session.installationIds, limit]);
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const reviews = rows.flatMap((row): ReviewListEntry[] => {
      const id = text(row, "id");
      const repositoryId = text(row, "repository_id");
      if (!id || !repositoryId) return [];
      const pullRequestNumber = row.pull_request_number;
      return [
        {
          id,
          repositoryId,
          repositoryName: `${text(row, "owner") ?? ""}/${text(row, "repository_name") ?? ""}`,
          pullRequestNumber: typeof pullRequestNumber === "number" ? pullRequestNumber : undefined,
          title: text(row, "title") ?? "Untitled review",
          status: text(row, "status") ?? "unknown",
          decision: text(row, "decision") ?? "pending",
          createdBy: text(row, "created_by") ?? "unknown",
          updatedAt: text(row, "updated_at") ?? "",
        },
      ];
    });
    return { state: "ok", reviews, next: undefined };
  } finally {
    await executor.close();
  }
}
