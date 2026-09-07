import { reviewFixturesEnabled } from "./review-listing.js";
import type { UserSession } from "./user-session.js";

/**
 * The evidence ledger: every revision of every review the viewer's installations reach.
 *
 * `review_revisions` is where the product's central claim lives. Each row pins one revision of a
 * review to a `evidence_digest` — the SHA-256 of the evidence pack — and to the commits it was
 * computed from. That digest is what `boardreadyops release verify` recomputes offline, so the
 * page's job is to show which digest belongs to which decision, not to re-explain the concept.
 *
 * Scoped through `reviews → repositories → installations` on `github_installation_id`, the same
 * tenant WHERE as `lib/run-listing.ts` and `lib/review-listing.ts`, down to the cancelled
 * marketplace subscription exclusion.
 */

export type EvidenceLedgerEntry = {
  revisionId: string;
  reviewId: string;
  reviewTitle: string;
  repositoryName: string;
  pullRequestNumber: number | undefined;
  sequence: number;
  headCommitSha: string;
  baseCommitSha: string | undefined;
  evidenceDigest: string;
  /** The review's decision at read time, not a per-revision record — the schema keeps one. */
  decision: string;
  reviewStatus: string;
  createdAt: string;
};

export type EvidenceLedgerResult =
  | { state: "signed-out" }
  /** No database configured: the page explains offline verification rather than 500ing. */
  | { state: "not-configured" }
  | { state: "ok"; entries: readonly EvidenceLedgerEntry[] };

const defaultPageSize = 50;
const maxPageSize = 200;

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function count(row: Record<string, unknown>, name: string): number | undefined {
  const value = row[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number(value);
  return undefined;
}

const evidenceLedgerQuery = `
  select review_revisions.id as revision_id,
         review_revisions.review_id,
         review_revisions.sequence,
         review_revisions.head_commit_sha,
         review_revisions.base_commit_sha,
         review_revisions.evidence_digest,
         review_revisions.created_at,
         reviews.title as review_title,
         reviews.decision,
         reviews.status as review_status,
         reviews.pull_request_number,
         repositories.owner,
         repositories.name as repository_name
    from review_revisions
    join reviews on reviews.id = review_revisions.review_id
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
   order by review_revisions.created_at desc, review_revisions.id desc
   limit $2`;

export async function loadEvidenceLedger(
  session: UserSession | undefined,
  options: { limit?: number } = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<EvidenceLedgerResult> {
  // No Postgres means no ledger to show. Unlike reviews there are no fixtures to fall back to:
  // a fabricated evidence digest would be the one thing on this page that must never be invented,
  // since the whole point is that the digest can be recomputed and checked.
  if (reviewFixturesEnabled(environment)) return { state: "not-configured" };
  if (!session || session.installationIds.length === 0) return { state: "signed-out" };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const limit = Math.min(Math.max(options.limit ?? defaultPageSize, 1), maxPageSize);
  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const result = await executor.query(evidenceLedgerQuery, [session.installationIds, limit]);
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const entries = rows.flatMap((row): EvidenceLedgerEntry[] => {
      const revisionId = text(row, "revision_id");
      const reviewId = text(row, "review_id");
      const evidenceDigest = text(row, "evidence_digest");
      const headCommitSha = text(row, "head_commit_sha");
      // A revision without its digest or head commit cannot be verified, so it is not evidence
      // and does not belong in a ledger that claims everything in it can be checked.
      if (!revisionId || !reviewId || !evidenceDigest || !headCommitSha) return [];

      return [
        {
          revisionId,
          reviewId,
          reviewTitle: text(row, "review_title") ?? "Untitled review",
          repositoryName: `${text(row, "owner") ?? ""}/${text(row, "repository_name") ?? ""}`,
          pullRequestNumber: count(row, "pull_request_number"),
          sequence: count(row, "sequence") ?? 0,
          headCommitSha,
          baseCommitSha: text(row, "base_commit_sha"),
          evidenceDigest,
          decision: text(row, "decision") ?? "pending",
          reviewStatus: text(row, "review_status") ?? "unknown",
          createdAt: text(row, "created_at") ?? "",
        },
      ];
    });
    return { state: "ok", entries };
  } finally {
    await executor.close();
  }
}
