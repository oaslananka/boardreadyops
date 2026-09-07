import type { ApiTokenRecord } from "@boardreadyops/db";
import { loadViewerRepositories, type RepositorySummary } from "./repository-dashboard.js";
import type { UserSession } from "./user-session.js";

/**
 * Repository-scoped API token administration for the settings UI.
 *
 * `POST /api/v1/tokens` resolves its repository through `resolveRepositoryApiContext`, which
 * expects a bearer token or a request-scoped context. A Server Action has neither, so the
 * authorization check is done here the same way every other page does it: re-resolve the
 * repositories the session's installations actually reach, and refuse anything outside that set.
 * The requested id is never trusted on its own.
 */

export type TokenAdminScope = {
  repositories: readonly RepositorySummary[];
  selected: RepositorySummary | undefined;
};

/**
 * Resolves the viewer's administrable repositories and which one the page is showing.
 *
 * Returns `selected: undefined` for an id the viewer cannot reach, so the caller renders the
 * picker rather than another repository's tokens.
 */
export async function resolveTokenAdminScope(
  session: UserSession | undefined,
  requestedRepositoryId: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<TokenAdminScope> {
  const groups = await loadViewerRepositories(session, environment);
  const repositories = groups.flatMap((group) => group.repositories);
  const selected =
    requestedRepositoryId === undefined
      ? repositories[0]
      : repositories.find((repository) => repository.id === requestedRepositoryId);
  return { repositories, selected };
}

export async function listRepositoryTokens(
  repositoryId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<readonly ApiTokenRecord[]> {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return [];

  const [{ ApiTokenStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    return await new ApiTokenStore(executor).listTokens(repositoryId);
  } finally {
    await executor.close();
  }
}

/** A token is usable only while it is neither revoked nor past its expiry. */
export function tokenState(record: ApiTokenRecord, now: Date = new Date()): "active" | "revoked" | "expired" {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return "expired";
  return "active";
}
