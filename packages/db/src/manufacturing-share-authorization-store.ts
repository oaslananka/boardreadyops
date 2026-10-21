import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * Explicit human permission to SHARE an existing manufacturing artifact.
 * This is neither a cryptographic signature nor a fabrication approval.
 */
export type ManufacturingSharePrincipal = Readonly<{ githubUserId: number; login: string }>;

export async function authorizeManufacturingShare(
  executor: SqlQueryExecutor,
  revisionId: string,
  principal: ManufacturingSharePrincipal,
): Promise<boolean> {
  if (!Number.isSafeInteger(principal.githubUserId) || principal.githubUserId <= 0 || !principal.login) return false;
  const sql = [
    "insert into manufacturing_share_authorizations",
    "(revision_id, workspace_id, run_id, artifact_id, commit_sha, archive_sha256,",
    "authorized_by_github_user_id, authorized_by_login)",
    "select revision.id, project.workspace_id, run.id, artifact.id, run.commit_sha, artifact.sha256, $2, $3",
    "from revisions as revision",
    "join projects as project on project.id = revision.project_id",
    "join workspace_members as member on member.workspace_id = project.workspace_id",
    "and member.github_user_id = $2 and member.role in ('owner','admin')",
    "join repositories as repository on",
    "lower(repository.owner || '/' || repository.name) = lower(project.github_repo_full_name)",
    "join release_runs as run on run.id = revision.validation_run_id",
    "and run.repository_id = repository.id and run.status = 'completed'",
    "and run.decision = 'pass' and run.completed_at is not null",
    "join artifacts as artifact on artifact.id = revision.validation_artifact_id",
    "and artifact.run_id = run.id and artifact.role = 'manufacturing'",
    "and artifact.kind = 'archive' and artifact.bytes > 0 and artifact.sha256 ~ '^[0-9a-f]{64}$'",
    "where revision.id = $1 and revision.commit_sha = run.commit_sha",
    "and revision.bundle_sha256 = artifact.sha256",
    "on conflict (revision_id) do nothing returning revision_id",
  ].join(" ");
  const result = (await executor.query(sql, [revisionId, principal.githubUserId, principal.login])) as {
    rows?: unknown[];
  };
  return (result.rows?.length ?? 0) === 1;
}

export async function revokeManufacturingShare(
  executor: SqlQueryExecutor,
  revisionId: string,
  principal: ManufacturingSharePrincipal,
): Promise<boolean> {
  if (!Number.isSafeInteger(principal.githubUserId) || principal.githubUserId <= 0 || !principal.login) return false;
  const result = (await executor.query(
    [
      "update manufacturing_share_authorizations as share set revoked_at = now(),",
      "revoked_by_github_user_id = $2, revoked_by_login = $3",
      "from workspace_members as member",
      "where share.revision_id = $1 and share.workspace_id = member.workspace_id",
      "and member.github_user_id = $2 and member.role in ('owner','admin')",
      "and share.revoked_at is null returning share.revision_id",
    ].join(" "),
    [revisionId, principal.githubUserId, principal.login],
  )) as { rows?: unknown[] };
  return (result.rows?.length ?? 0) === 1;
}

export async function authorizedManufacturingRevisionIds(
  executor: SqlQueryExecutor,
  workspaceId: string,
): Promise<readonly string[]> {
  const result = (await executor.query(
    [
      "select share.revision_id from manufacturing_share_authorizations as share",
      "join revisions as revision on revision.id = share.revision_id",
      "join projects as project on project.id = revision.project_id",
      "join repositories as repository on",
      "lower(repository.owner || '/' || repository.name) = lower(project.github_repo_full_name)",
      "join release_runs as run on run.id = share.run_id",
      "and run.repository_id = repository.id",
      "and run.id = revision.validation_run_id and run.status = 'completed'",
      "and run.decision = 'pass' and run.completed_at is not null",
      "join artifacts as artifact on artifact.id = share.artifact_id",
      "and artifact.id = revision.validation_artifact_id and artifact.run_id = run.id",
      "and artifact.kind = 'archive' and artifact.role = 'manufacturing'",
      "and artifact.bytes > 0 and artifact.sha256 ~ '^[0-9a-f]{64}$'",
      "where share.workspace_id = $1 and project.workspace_id = $1",
      "and share.revoked_at is null",
      "and share.commit_sha = run.commit_sha",
      "and revision.commit_sha = run.commit_sha",
      "and share.archive_sha256 = artifact.sha256",
      "and revision.bundle_sha256 = artifact.sha256",
    ].join(" "),
    [workspaceId],
  )) as { rows?: { revision_id: string }[] };
  return (result.rows ?? []).map((row) => row.revision_id);
}

export async function revisionHasManufacturingShareAuthorization(
  executor: SqlQueryExecutor,
  revisionId: string,
): Promise<boolean> {
  const result = (await executor.query(
    [
      "select 1 from manufacturing_share_authorizations as share",
      "join revisions as revision on revision.id = share.revision_id",
      "join projects as project on project.id = revision.project_id",
      "join repositories as repository on",
      "lower(repository.owner || '/' || repository.name) = lower(project.github_repo_full_name)",
      "join release_runs as run on run.id = share.run_id",
      "and run.repository_id = repository.id",
      "and run.id = revision.validation_run_id and run.status = 'completed'",
      "and run.decision = 'pass' and run.completed_at is not null",
      "join artifacts as artifact on artifact.id = share.artifact_id",
      "and artifact.id = revision.validation_artifact_id and artifact.run_id = run.id",
      "and artifact.kind = 'archive' and artifact.role = 'manufacturing'",
      "and artifact.bytes > 0 and artifact.sha256 ~ '^[0-9a-f]{64}$'",
      "where share.revision_id = $1 and share.revoked_at is null",
      "and share.workspace_id = project.workspace_id",
      "and share.commit_sha = run.commit_sha and revision.commit_sha = run.commit_sha",
      "and share.archive_sha256 = artifact.sha256 and revision.bundle_sha256 = artifact.sha256",
      "limit 1",
    ].join(" "),
    [revisionId],
  )) as { rows?: unknown[] };
  return (result.rows?.length ?? 0) > 0;
}
