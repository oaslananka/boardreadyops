import { cookies } from "next/headers";
import { resolveLiveInstallationRepositoryIds } from "./live-installation-repositories.js";
import { notCancelledSubscription } from "./tenant-scope.js";
import {
  configuredSessionSecret,
  decodeUserSession,
  sessionAllowsInstallation,
  type UserSession,
} from "./user-session.js";

/**
 * Turns the session cookie into the repository authorization the dashboard loader asks for.
 *
 * Before this existed, `loadRunDashboard` was called with no authorizer, so every private
 * repository resolved to "not found" for everyone including its own owner. Public runs stay
 * open to anyone holding the link, which is the documented behaviour.
 */

export const sessionCookieName = "brops_session";

/** Eight hours: long enough for a working day, short enough that revoked access lapses. */
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;

export type ViewerAuthorization = {
  session: UserSession | undefined;
  authorizeRepository: (repository: { installationId: string; id?: string }) => Promise<boolean>;
  /**
   * Whether the viewer may act on an installation itself.
   *
   * Same check as authorizeRepository, named for what the caller is actually asking. Settings
   * pages act on an installation rather than a repository, and reading a repository-shaped
   * helper there invites someone to pass the wrong id.
   */
  authorizeInstallation: (installationId: string) => Promise<boolean>;
};

/**
 * Reads the current viewer and returns an authorizer bound to them.
 *
 * The authorizer resolves the repository's *GitHub* installation id from the database rather
 * than trusting anything in the request, then checks it against the installations the session
 * recorded. Without a valid session it denies, so a missing or expired cookie can never widen
 * access.
 */
export async function viewerAuthorization(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): Promise<ViewerAuthorization> {
  // cookies() is read unconditionally, and that is the point: reading it is what marks a page
  // as per-request. Gating the call on configuration made a page's dynamism depend on whether
  // SESSION_SECRET happened to be set during `next build`. It is not passed to the build, so
  // the landing page was prerendered in its signed-out state and kept serving that HTML to
  // everyone, signed in or not.
  const token = (await cookies()).get(sessionCookieName)?.value;
  const secret = configuredSessionSecret(environment);
  const session = secret && token ? decodeUserSession(token, secret, now) : undefined;

  const authorizeInstallation = async (installationId: string): Promise<boolean> => {
    if (!session) return false;
    const githubInstallationId = await githubInstallationIdFor(installationId, environment);
    return githubInstallationId !== undefined && sessionAllowsInstallation(session, githubInstallationId);
  };

  return {
    session,
    authorizeRepository: async (repository) => {
      if (!session || !repository.id) return false;
      const scope = await currentRepositoryScope(repository.id, repository.installationId, environment);
      if (!scope || !sessionAllowsInstallation(session, scope.githubInstallationId)) return false;
      const granted = await resolveLiveInstallationRepositoryIds([scope.githubInstallationId], environment);
      return granted?.includes(scope.githubRepoId) ?? false;
    },
    authorizeInstallation,
  };
}

/**
 * Maps the internal installation UUID to the GitHub installation id the session knows about.
 *
 * The session stores GitHub's ids because that is what the OAuth flow returns; the dashboard
 * carries the internal id. Resolving here keeps the mapping server-side and out of the cookie.
 */
function numericId(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "string" ? Number(value) : Number.NaN;
}

async function githubInstallationIdFor(
  installationId: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<number | undefined> {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return undefined;

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const result = await executor.query(
      `select installations.github_installation_id
         from installations
        where installations.id = $1
          and installations.suspended_at is null
          and ${notCancelledSubscription}`,
      [installationId],
    );
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const value = rows[0]?.github_installation_id;
    // node-postgres decodes bigint as a string to avoid precision loss.
    const parsed = numericId(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  } finally {
    await executor.close();
  }
}

/** Protect private Run links by current GitHub repo ID and exact installation.
 * Public Run links retain their separately documented public behavior.
 */
async function currentRepositoryScope(
  repositoryId: string,
  installationId: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ githubInstallationId: number; githubRepoId: number } | undefined> {
  if (!environment.DATABASE_URL) return undefined;
  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString: environment.DATABASE_URL, max: 1 });
  try {
    const result = await executor.query(
      `select installations.github_installation_id, repositories.github_repo_id
         from repositories
         join installations on installations.id = repositories.installation_id
        where repositories.id = $1 and repositories.installation_id = $2
          and repositories.disabled_at is null
          and installations.suspended_at is null
          and ${notCancelledSubscription}`,
      [repositoryId, installationId],
    );
    const first = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];
    const githubInstallationId = numericId(first?.github_installation_id);
    const githubRepoId = numericId(first?.github_repo_id);
    if (!Number.isSafeInteger(githubInstallationId) || githubInstallationId <= 0) return undefined;
    if (!Number.isSafeInteger(githubRepoId) || githubRepoId <= 0) return undefined;
    return { githubInstallationId, githubRepoId };
  } finally {
    await executor.close();
  }
}
