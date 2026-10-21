import { ProtectedReleaseIntentStore } from "@boardreadyops/db";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { inspectProtectedReleaseIntentCandidate } from "./protected-release-intent.js";
import type { UserSession } from "./user-session.js";

/**
 * Internal, non-dispatching operator-intent evidence recorder.
 * No HTTP route, workflow, lease, release-run or callback is enabled here.
 * The caller supplies an already-validated signed GitHub viewer session.
 */
export async function recordProtectedReleaseIntentForViewer(
  input: {
    session: UserSession;
    repositoryId: string;
    sha: string;
    requestId: string;
  },
  dependencies: {
    db: SqlQueryExecutor;
    installationToken: (githubInstallationId: number) => Promise<string>;
    now: () => Date;
    githubRequest?: typeof fetch;
  },
): Promise<{ id: string; inserted: boolean } | undefined> {
  const { session } = input;
  const now = dependencies.now();
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(session.userId) ||
    session.userId <= 0 ||
    !Array.isArray(session.installationIds) ||
    !Number.isFinite(Date.parse(session.issuedAt)) ||
    Date.parse(session.issuedAt) > now.getTime() ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    Date.parse(session.expiresAt) <= now.getTime() ||
    !input.repositoryId ||
    input.repositoryId.length > 128
  )
    return undefined;

  const statement = [
    "select repositories.id as repository_id, repositories.github_repo_id,",
    "repositories.owner, repositories.name, repositories.default_branch,",
    "repositories.private as repository_private,",
    "installations.id as installation_id, installations.github_installation_id",
    "from repositories join installations on installations.id = repositories.installation_id",
    "where repositories.id = $1 and repositories.disabled_at is null",
    "and repositories.private = false",
    "and installations.suspended_at is null limit 1",
  ].join(" ");
  const result = (await dependencies.db.query(statement, [input.repositoryId])) as {
    rows?: Array<Record<string, unknown>>;
  };
  const row = result.rows?.[0];
  if (!row) return undefined;

  const githubInstallationId = Number(row.github_installation_id);
  const githubRepositoryId = Number(row.github_repo_id);
  if (
    !Number.isSafeInteger(githubInstallationId) ||
    githubInstallationId <= 0 ||
    !Number.isSafeInteger(githubRepositoryId) ||
    githubRepositoryId <= 0 ||
    typeof row.installation_id !== "string" ||
    typeof row.repository_id !== "string" ||
    typeof row.owner !== "string" ||
    typeof row.name !== "string" ||
    typeof row.default_branch !== "string" ||
    row.repository_private !== false ||
    !session.installationIds.includes(githubInstallationId)
  )
    return undefined;

  const token = await dependencies.installationToken(githubInstallationId);
  if (!token) return undefined;
  const candidate = await inspectProtectedReleaseIntentCandidate({
    actor: {
      authType: "session",
      login: session.login,
      githubUserId: session.userId,
      installationIds: session.installationIds,
    },
    repository: {
      installationId: githubInstallationId,
      repositoryId: row.repository_id,
      githubRepositoryId,
      owner: row.owner,
      name: row.name,
      defaultBranch: row.default_branch,
    },
    intent: {
      kind: "protected-branch",
      ref: `refs/heads/${row.default_branch}`,
      sha: input.sha,
      requestId: input.requestId,
    },
    installation: { id: githubInstallationId, token },
    apiBaseUrl: "https://api.github.com",
    ...(dependencies.githubRequest ? { request: dependencies.githubRequest } : {}),
  });
  if (!candidate) return undefined;

  return new ProtectedReleaseIntentStore(dependencies.db).record(candidate, {
    internalInstallationId: row.installation_id,
    githubInstallationId,
    observedAt: now,
  });
}
