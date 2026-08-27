import type { UserSession } from "./user-session.js";

/**
 * Cross-repository, cursor-paginated run listing for a signed-in viewer.
 *
 * `apps/web/lib/repository-dashboard.ts` already scopes queries by the session's installation
 * ids; this module follows the same tenant-scoping shape but lists runs across every repository
 * the viewer can see, rather than one repository's history or one row per repository.
 *
 * The cursor carries no authority of its own — it only resumes a keyset scan within a query that
 * is independently scoped to the caller's own installation ids in the same WHERE clause, so a
 * tampered or hand-built cursor cannot surface another tenant's rows. It only needs to be
 * well-formed, not signed.
 */

type RunListingEntry = {
  id: string;
  repositoryId: string;
  status: string;
  decision: string | undefined;
  commitSha: string;
  ref: string;
  pullRequestNumber: number | undefined;
  startedAt: string;
};

export type RunListingCursor = { startedAt: string; id: string };

export type RunListingResult =
  | { state: "not-configured" }
  | { state: "ok"; runs: RunListingEntry[]; next: string | undefined };

const defaultPageSize = 25;
const maxPageSize = 100;
const maxCursorIdLength = 128;

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

export function encodeRunListingCursor(cursor: RunListingCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Returns `undefined` for a missing, malformed, or oversized cursor rather than throwing. */
export function decodeRunListingCursor(value: string | null): RunListingCursor | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.startedAt !== "string" || Number.isNaN(Date.parse(candidate.startedAt))) return undefined;
  if (typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.id.length > maxCursorIdLength) {
    return undefined;
  }
  return { startedAt: candidate.startedAt, id: candidate.id };
}

/** Clamps an untrusted requested page size to `[1, maxPageSize]`, defaulting when absent or invalid. */
export function normalizedRunListingLimit(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value)) return defaultPageSize;
  return Math.min(Math.max(value, 1), maxPageSize);
}

const runListingQuery = `
  select release_runs.id,
         release_runs.repository_id,
         release_runs.status,
         release_runs.decision,
         release_runs.commit_sha,
         release_runs.ref,
         release_runs.pull_request_number,
         release_runs.started_at
    from release_runs
    join repositories on repositories.id = release_runs.repository_id
    join installations on installations.id = repositories.installation_id
   where installations.github_installation_id = any($1::bigint[])
     and repositories.disabled_at is null
     and ($2::timestamptz is null or (release_runs.started_at, release_runs.id) < ($2::timestamptz, $3::text))
   order by release_runs.started_at desc, release_runs.id desc
   limit $4`;

/**
 * Lists runs across every repository the session's installations grant access to.
 *
 * Fetches one row beyond the requested page to determine whether a `next` cursor is needed,
 * without a separate count query.
 */
export async function loadViewerRuns(
  session: UserSession | undefined,
  options: { cursor?: RunListingCursor; limit?: number } = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RunListingResult> {
  if (!session || session.installationIds.length === 0) return { state: "ok", runs: [], next: undefined };
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const limit = normalizedRunListingLimit(options.limit);
  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const result = await executor.query(runListingQuery, [
      session.installationIds,
      options.cursor?.startedAt ?? null,
      options.cursor?.id ?? null,
      limit + 1,
    ]);
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const page = rows.slice(0, limit);

    const runs = page.flatMap((row): RunListingEntry[] => {
      const id = text(row, "id");
      const repositoryId = text(row, "repository_id");
      const startedAt = text(row, "started_at");
      if (!id || !repositoryId || !startedAt) return [];
      const pullRequestNumber = row.pull_request_number;
      return [
        {
          id,
          repositoryId,
          status: text(row, "status") ?? "unknown",
          decision: text(row, "decision"),
          commitSha: text(row, "commit_sha") ?? "",
          ref: text(row, "ref") ?? "",
          pullRequestNumber: typeof pullRequestNumber === "number" ? pullRequestNumber : undefined,
          startedAt,
        },
      ];
    });

    const hasMore = rows.length > limit;
    const last = runs.at(-1);
    const next = hasMore && last ? encodeRunListingCursor({ startedAt: last.startedAt, id: last.id }) : undefined;
    return { state: "ok", runs, next };
  } finally {
    await executor.close();
  }
}
