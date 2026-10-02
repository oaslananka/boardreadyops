import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type WorkspacePlanTier = "community" | "team" | "business" | "pilot";

/** Matches the `workspace_members.role` check constraint in migration 0064. */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type WorkspacePrincipal = {
  githubUserId: number;
  login: string;
};

export type VerifiedWorkspacePrincipal = WorkspacePrincipal & {
  displayName?: string;
  avatarUrl?: string;
};

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  planTier: WorkspacePlanTier;
  stripeCustomerId?: string | undefined;
  createdAt: string;
}

/**
 * One person's membership of a workspace.
 *
 * `userId` remains the legacy storage key for migration compatibility. New grants are pinned to
 * `githubUserId`; authorization prefers that stable id so a later GitHub login rename does not
 * transfer access to a different account.
 */
export interface WorkspaceMemberRecord {
  workspaceId: string;
  userId: string;
  githubUserId?: number;
  githubLogin: string;
  githubDisplayName?: string;
  githubAvatarUrl?: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMembershipRecord extends WorkspaceRecord {
  role: WorkspaceRole;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | undefined;
  defaultCadFormat: string;
  githubRepoFullName?: string | undefined;
  createdAt: string;
}

export interface RevisionRecord {
  id: string;
  projectId: string;
  revisionLabel: string;
  sourceKind: "direct_upload" | "github_commit" | "native_export";
  commitSha?: string | undefined;
  bundleSha256: string;
  normalizedSummary: Record<string, unknown>;
  validationRunId?: string | undefined;
  validationArtifactId?: string | undefined;
  createdAt: string;
}

/** A trusted manufacturing archive from a completed passing BoardReadyOps run. */
export interface ValidatedRevisionCandidate {
  projectId: string;
  projectName: string;
  runId: string;
  commitSha: string;
  completedAt: string;
  artifactId: string;
  artifactName: string;
  bundleSha256: string;
}

/** A revision with the project it belongs to, for surfaces that list across a workspace. */
export interface WorkspaceRevisionRecord extends RevisionRecord {
  projectName: string;
}

/**
 * A delivery with the revision and project it points at.
 *
 * `accessTokenHash` is deliberately absent: a listing has no use for it, and the hash is the one
 * stored value from which a guest URL could be checked against a guess.
 */
export interface WorkspaceDeliveryRecord {
  id: string;
  revisionId: string;
  revisionLabel: string;
  projectId: string;
  projectName: string;
  expiresAt: string;
  signedArchiveUrl: string;
  recipientNotes?: string | undefined;
  createdAt: string;
}

export interface DeliveryRecord {
  id: string;
  revisionId: string;
  accessTokenHash: string;
  expiresAt: string;
  signedArchiveUrl: string;
  recipientNotes?: string | undefined;
  createdAt: string;
}

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  stripe_customer_id: string | null;
  created_at: string | Date;
};

type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  github_user_id: number | string | null;
  github_login: string | null;
  github_display_name: string | null;
  github_avatar_url: string | null;
  role: string;
  created_at: string | Date;
};

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  default_cad_format: string;
  github_repo_full_name: string | null;
  created_at: string | Date;
};

type RevisionRow = {
  id: string;
  project_id: string;
  revision_label: string;
  source_kind: string;
  commit_sha: string | null;
  bundle_sha256: string;
  normalized_summary: Record<string, unknown> | string;
  validation_run_id: string | null;
  validation_artifact_id: string | null;
  created_at: string | Date;
};

type DeliveryRow = {
  id: string;
  revision_id: string;
  access_token_hash: string;
  expires_at: string | Date;
  signed_archive_url: string;
  recipient_notes: string | null;
  created_at: string | Date;
};

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    planTier: row.plan_tier as WorkspacePlanTier,
    ...(row.stripe_customer_id !== null ? { stripeCustomerId: row.stripe_customer_id } : {}),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMemberRecord {
  const githubUserId = row.github_user_id === null ? undefined : Number(row.github_user_id);
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    ...(githubUserId !== undefined && Number.isSafeInteger(githubUserId) && githubUserId > 0 ? { githubUserId } : {}),
    githubLogin: row.github_login ?? row.user_id,
    ...(row.github_display_name ? { githubDisplayName: row.github_display_name } : {}),
    ...(row.github_avatar_url ? { githubAvatarUrl: row.github_avatar_url } : {}),
    role: (row.role === "owner" || row.role === "admin" || row.role === "member"
      ? row.role
      : "viewer") as WorkspaceRole,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    defaultCadFormat: row.default_cad_format,
    ...(row.github_repo_full_name !== null ? { githubRepoFullName: row.github_repo_full_name } : {}),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapRevision(row: RevisionRow): RevisionRecord {
  const summary =
    typeof row.normalized_summary === "string" ? JSON.parse(row.normalized_summary) : (row.normalized_summary ?? {});
  return {
    id: row.id,
    projectId: row.project_id,
    revisionLabel: row.revision_label,
    sourceKind: row.source_kind as RevisionRecord["sourceKind"],
    ...(row.commit_sha !== null ? { commitSha: row.commit_sha } : {}),
    bundleSha256: row.bundle_sha256,
    normalizedSummary: summary,
    ...(typeof row.validation_run_id === "string" ? { validationRunId: row.validation_run_id } : {}),
    ...(typeof row.validation_artifact_id === "string" ? { validationArtifactId: row.validation_artifact_id } : {}),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    revisionId: row.revision_id,
    accessTokenHash: row.access_token_hash,
    expiresAt: new Date(row.expires_at).toISOString(),
    signedArchiveUrl: row.signed_archive_url,
    ...(row.recipient_notes !== null ? { recipientNotes: row.recipient_notes } : {}),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class WorkspaceStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  /**
   * Creates a workspace and its owner in one statement.
   *
   * `ownerUserId` is required rather than optional: a workspace with no member cannot be
   * authorized, and every caller that could see it would be equally entitled to it. Both rows are
   * written by a single CTE so a workspace can never exist without an owner, which the executor
   * cannot otherwise guarantee -- it exposes `query`, not a transaction.
   */
  async createWorkspace(input: {
    id?: string | undefined;
    name: string;
    slug: string;
    ownerUserId: string;
    ownerGitHubUserId?: number | undefined;
    ownerGitHubLogin?: string | undefined;
    planTier?: WorkspacePlanTier | undefined;
    stripeCustomerId?: string | undefined;
  }): Promise<WorkspaceRecord> {
    const id = input.id ?? `ws_${randomUUID()}`;
    const planTier = input.planTier ?? "community";
    const result = (await this.executor.query(
      `with created as (
         insert into workspaces (id, name, slug, plan_tier, stripe_customer_id)
         values ($1, $2, $3, $4, $5)
         returning id, name, slug, plan_tier, stripe_customer_id, created_at
       ), owner_membership as (
         insert into workspace_members (workspace_id, user_id, github_user_id, github_login, role)
         select created.id, $6, $7, coalesce($8, $6), 'owner' from created
       )
       select id, name, slug, plan_tier, stripe_customer_id, created_at from created`,
      [
        id,
        input.name,
        input.slug,
        planTier,
        input.stripeCustomerId ?? null,
        input.ownerUserId,
        input.ownerGitHubUserId ?? null,
        input.ownerGitHubLogin ?? null,
      ],
    )) as { rows?: WorkspaceRow[] };

    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert workspace");
    }
    return mapWorkspace(row);
  }

  /** Binds a pre-0071 login-only membership to a verified stable GitHub identity. */
  private async bindLegacyWorkspaceIdentity(principal: WorkspacePrincipal): Promise<void> {
    await this.executor.query(
      `update workspace_members as legacy
          set github_user_id = $1,
              github_login = $2
        where legacy.github_user_id is null
          and lower(legacy.user_id) = lower($2)
          and not exists (
            select 1
              from workspace_members as stable
             where stable.workspace_id = legacy.workspace_id
               and stable.github_user_id = $1
          )`,
      [principal.githubUserId, principal.login],
    );
  }

  /** The caller's role in a workspace, or `null` when they are not a member of it. */
  async workspaceRoleFor(workspaceId: string, principal: string | WorkspacePrincipal): Promise<WorkspaceRole | null> {
    if (typeof principal !== "string") await this.bindLegacyWorkspaceIdentity(principal);
    const result = (await this.executor.query(
      typeof principal === "string"
        ? `select role from workspace_members where workspace_id = $1 and lower(user_id) = lower($2)`
        : `select role
             from workspace_members
            where workspace_id = $1
              and (github_user_id = $2 or (github_user_id is null and lower(user_id) = lower($3)))
            order by (github_user_id = $2) desc
            limit 1`,
      typeof principal === "string" ? [workspaceId, principal] : [workspaceId, principal.githubUserId, principal.login],
    )) as { rows?: { role: string }[] };

    const role = result?.rows?.[0]?.role;
    return role === "owner" || role === "admin" || role === "member" || role === "viewer" ? role : null;
  }

  /** Every workspace the user belongs to, newest first. */
  async listWorkspacesForUser(principal: string | WorkspacePrincipal): Promise<readonly WorkspaceMembershipRecord[]> {
    if (typeof principal !== "string") await this.bindLegacyWorkspaceIdentity(principal);
    const result = (await this.executor.query(
      typeof principal === "string"
        ? `select workspaces.id, workspaces.name, workspaces.slug, workspaces.plan_tier,
                  workspaces.stripe_customer_id, workspaces.created_at, workspace_members.role
             from workspace_members
             join workspaces on workspaces.id = workspace_members.workspace_id
            where lower(workspace_members.user_id) = lower($1)
            order by workspaces.created_at desc, workspaces.id desc`
        : `select workspaces.id, workspaces.name, workspaces.slug, workspaces.plan_tier,
                  workspaces.stripe_customer_id, workspaces.created_at, workspace_members.role
             from workspace_members
             join workspaces on workspaces.id = workspace_members.workspace_id
            where workspace_members.github_user_id = $1
               or (workspace_members.github_user_id is null and lower(workspace_members.user_id) = lower($2))
            order by workspaces.created_at desc, workspaces.id desc`,
      typeof principal === "string" ? [principal] : [principal.githubUserId, principal.login],
    )) as { rows?: (WorkspaceRow & { role: string })[] };

    return (result?.rows ?? []).map((row) => ({
      ...mapWorkspace(row),
      role: (row.role === "owner" || row.role === "admin" || row.role === "member"
        ? row.role
        : "viewer") as WorkspaceRole,
    }));
  }
  /**
   * A workspace by slug, with the logins that own it.
   *
   * Exists for one question that was previously unanswerable: someone is told their chosen slug
   * is taken, on a page that has just told them they belong to no workspaces. Both statements are
   * true -- slugs are a single global namespace because they appear in URLs, while the page lists
   * only your own memberships -- so the conflict is usually with a workspace the person cannot
   * see, and nobody could say which.
   *
   * Owners rather than every member: enough to route the question to a human, and no more of
   * other people's membership than that needs.
   */
  async findWorkspaceBySlugWithOwners(
    slug: string,
  ): Promise<{ workspace: WorkspaceRecord; owners: readonly string[] } | null> {
    const workspace = await this.getWorkspaceBySlug(slug);
    if (!workspace) return null;

    const result = (await this.executor.query(
      `select user_id
         from workspace_members
        where workspace_id = $1 and role = 'owner'
        order by user_id`,
      [workspace.id],
    )) as { rows?: { user_id: string }[] };

    return { workspace, owners: (result?.rows ?? []).map((row) => row.user_id) };
  }

  async getWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> {
    const result = (await this.executor.query(
      `select id, name, slug, plan_tier, stripe_customer_id, created_at
       from workspaces
       where slug = $1`,
      [slug],
    )) as { rows?: WorkspaceRow[] };

    const row = result?.rows?.[0];
    return row ? mapWorkspace(row) : null;
  }

  async getWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    const result = (await this.executor.query(
      `select id, name, slug, plan_tier, stripe_customer_id, created_at
       from workspaces
       where id = $1`,
      [id],
    )) as { rows?: WorkspaceRow[] };

    const row = result?.rows?.[0];
    return row ? mapWorkspace(row) : null;
  }

  /**
   * Members of one workspace, privileged roles first.
   *
   * `page` is optional because two callers need every member rather than a page of them: the
   * last-owner guard in the member actions, and the authorization checks. A limit there would
   * silently let the guard pass on a workspace whose only other owner was on page two.
   */
  async listWorkspaceMembers(
    workspaceId: string,
    page?: { limit: number; offset: number },
  ): Promise<readonly WorkspaceMemberRecord[]> {
    const result = (await this.executor.query(
      `select workspace_id, user_id, github_user_id, github_login, github_display_name,
              github_avatar_url, role, created_at
         from workspace_members
        where workspace_id = $1
        order by case role
                   when 'owner' then 0
                   when 'admin' then 1
                   when 'member' then 2
                   else 3
                 end,
                 user_id
        ${page ? "limit $2 offset $3" : ""}`,
      page ? [workspaceId, page.limit, page.offset] : [workspaceId],
    )) as { rows?: WorkspaceMemberRow[] };

    return (result?.rows ?? []).map(mapWorkspaceMember);
  }

  /**
   * Grants or changes access to a GitHub principal resolved immediately before this write.
   * Stable GitHub user id is authoritative; login/profile fields are display metadata.
   * The role mutation and audit row are one SQL statement.
   */
  async upsertWorkspaceMember(input: {
    workspaceId: string;
    subject: VerifiedWorkspacePrincipal;
    actor: WorkspacePrincipal;
    role: WorkspaceRole;
  }): Promise<WorkspaceMemberRecord> {
    const result = (await this.executor.query(
      `with existing as (
         select user_id, role
           from workspace_members
          where workspace_id = $1
            and (github_user_id = $2 or (github_user_id is null and lower(user_id) = lower($3)))
          order by (github_user_id = $2) desc
          limit 1
          for update
       ), updated as (
         update workspace_members
            set github_user_id = $2,
                github_login = $3,
                github_display_name = $4,
                github_avatar_url = $5,
                role = $6
          where workspace_id = $1
            and user_id = (select user_id from existing)
         returning workspace_id, user_id, github_user_id, github_login, github_display_name,
                   github_avatar_url, role, created_at
       ), inserted as (
         insert into workspace_members (
           workspace_id, user_id, github_user_id, github_login, github_display_name, github_avatar_url, role
         )
         select $1, $3, $2, $3, $4, $5, $6
          where not exists (select 1 from updated)
         returning workspace_id, user_id, github_user_id, github_login, github_display_name,
                   github_avatar_url, role, created_at
       ), member as (
         select * from updated
         union all
         select * from inserted
       ), audited as (
         insert into workspace_member_audit_events (
           workspace_id, event_type, actor_github_user_id, actor_login,
           subject_github_user_id, subject_login, previous_role, role
         )
         select $1, 'workspace_member.upsert', $7, $8, $2, $3, (select role from existing), $6
          from member
       )
       select * from member`,
      [
        input.workspaceId,
        input.subject.githubUserId,
        input.subject.login,
        input.subject.displayName ?? null,
        input.subject.avatarUrl ?? null,
        input.role,
        input.actor.githubUserId,
        input.actor.login,
      ],
    )) as { rows?: WorkspaceMemberRow[] };

    const row = result?.rows?.[0];
    if (!row) throw new Error("Failed to upsert workspace member");
    return mapWorkspaceMember(row);
  }
  /**
   * Removes a member, refusing to remove the last owner.
   *
   * A workspace with no owner cannot be administered by anyone: only owners and admins may manage
   * members, and an admin cannot promote themselves. The delete and the count are one statement so
   * two concurrent removals cannot each see the other's owner and both succeed.
   *
   * Returns whether a row was removed; `false` means either no such member or the last owner.
   */
  async removeWorkspaceMember(input: {
    workspaceId: string;
    userId: string;
    actor: WorkspacePrincipal;
  }): Promise<boolean> {
    const result = (await this.executor.query(
      `with removed as (
         delete from workspace_members
          where workspace_id = $1
            and user_id = $2
            and (
              role <> 'owner'
              or exists (
                select 1 from workspace_members as others
                 where others.workspace_id = $1
                   and others.user_id <> $2
                   and others.role = 'owner'
              )
            )
         returning user_id, github_user_id, coalesce(github_login, user_id) as github_login, role
       ), audited as (
         insert into workspace_member_audit_events (
           workspace_id, event_type, actor_github_user_id, actor_login,
           subject_github_user_id, subject_login, previous_role, role
         )
         select $1, 'workspace_member.remove', $3, $4,
                github_user_id, github_login, role, null
           from removed
       )
       select user_id from removed`,
      [input.workspaceId, input.userId, input.actor.githubUserId, input.actor.login],
    )) as { rows?: unknown[] };

    return (result?.rows ?? []).length > 0;
  }

  /** The workspace a project belongs to, for authorizing a request that names only the project. */
  async workspaceIdForProject(projectId: string): Promise<string | null> {
    const result = (await this.executor.query(`select workspace_id from projects where id = $1`, [projectId])) as {
      rows?: { workspace_id: string }[];
    };
    return result?.rows?.[0]?.workspace_id ?? null;
  }

  /** The workspace a revision belongs to, through its project. */
  async workspaceIdForRevision(revisionId: string): Promise<string | null> {
    const result = (await this.executor.query(
      `select projects.workspace_id
         from revisions
         join projects on projects.id = revisions.project_id
        where revisions.id = $1`,
      [revisionId],
    )) as { rows?: { workspace_id: string }[] };
    return result?.rows?.[0]?.workspace_id ?? null;
  }

  async createProject(input: {
    id?: string | undefined;
    workspaceId: string;
    name: string;
    description?: string | undefined;
    defaultCadFormat?: string | undefined;
    githubRepoFullName?: string | undefined;
  }): Promise<ProjectRecord> {
    const id = input.id ?? `prj_${randomUUID()}`;
    const defaultCad = input.defaultCadFormat ?? "kicad";
    const result = (await this.executor.query(
      `insert into projects (id, workspace_id, name, description, default_cad_format, github_repo_full_name)
       values ($1, $2, $3, $4, $5, $6)
       returning id, workspace_id, name, description, default_cad_format, github_repo_full_name, created_at`,
      [id, input.workspaceId, input.name, input.description ?? null, defaultCad, input.githubRepoFullName ?? null],
    )) as { rows?: ProjectRow[] };

    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert project");
    }
    return mapProject(row);
  }

  async listProjectsByWorkspace(
    workspaceId: string,
    page?: { limit: number; offset: number },
  ): Promise<ProjectRecord[]> {
    const result = (await this.executor.query(
      `select id, workspace_id, name, description, default_cad_format, github_repo_full_name, created_at
       from projects
       where workspace_id = $1
       order by created_at desc
       ${page ? "limit $2 offset $3" : ""}`,
      page ? [workspaceId, page.limit, page.offset] : [workspaceId],
    )) as { rows?: ProjectRow[] };

    return (result?.rows ?? []).map(mapProject);
  }

  async createRevisionFromUpload(input: {
    id?: string | undefined;
    projectId: string;
    revisionLabel: string;
    sourceKind?: "direct_upload" | "github_commit" | "native_export" | undefined;
    commitSha?: string | undefined;
    bundleSha256: string;
    normalizedSummary?: Record<string, unknown> | undefined;
  }): Promise<RevisionRecord> {
    const id = input.id ?? `rev_${randomUUID()}`;
    const sourceKind = input.sourceKind ?? "direct_upload";
    const summary = JSON.stringify(input.normalizedSummary ?? {});

    const result = (await this.executor.query(
      `insert into revisions (id, project_id, revision_label, source_kind, commit_sha, bundle_sha256, normalized_summary)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       returning id, project_id, revision_label, source_kind, commit_sha, bundle_sha256, normalized_summary,
                 validation_run_id, validation_artifact_id, created_at`,
      [id, input.projectId, input.revisionLabel, sourceKind, input.commitSha ?? null, input.bundleSha256, summary],
    )) as { rows?: RevisionRow[] };

    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert revision");
    }
    return mapRevision(row);
  }

  async getRevisionById(id: string): Promise<RevisionRecord | null> {
    const result = (await this.executor.query(
      `select id, project_id, revision_label, source_kind, commit_sha, bundle_sha256, normalized_summary,
              validation_run_id, validation_artifact_id, created_at
       from revisions
       where id = $1`,
      [id],
    )) as { rows?: RevisionRow[] };

    const row = result?.rows?.[0];
    return row ? mapRevision(row) : null;
  }

  /** Every revision in a workspace, newest first, with the project each belongs to. */
  async listRevisionsByWorkspace(workspaceId: string, limit = 200): Promise<readonly WorkspaceRevisionRecord[]> {
    const result = (await this.executor.query(
      `select revisions.id, revisions.project_id, revisions.revision_label, revisions.source_kind,
              revisions.commit_sha, revisions.bundle_sha256, revisions.normalized_summary,
              revisions.validation_run_id, revisions.validation_artifact_id,
              revisions.created_at, projects.name as project_name
         from revisions
         join projects on projects.id = revisions.project_id
        where projects.workspace_id = $1
        order by revisions.created_at desc, revisions.id desc
        limit $2`,
      [workspaceId, limit],
    )) as { rows?: (RevisionRow & { project_name: string })[] };

    return (result?.rows ?? []).map((row) => ({ ...mapRevision(row), projectName: row.project_name }));
  }

  /**
   * Manufacturing archives that can become shareable revisions.
   *
   * The candidate is derived from persisted control-plane evidence, not from browser input: the
   * run must be terminal/pass and the exact persisted artifact must be a non-empty manufacturing
   * archive with a SHA-256 digest. Already registered artifacts are omitted.
   */
  async listValidatedRevisionCandidatesByWorkspace(
    workspaceId: string,
    limit = 200,
  ): Promise<readonly ValidatedRevisionCandidate[]> {
    const result = (await this.executor.query(
      `select projects.id as project_id,
              projects.name as project_name,
              release_runs.id as run_id,
              release_runs.commit_sha,
              release_runs.completed_at,
              artifacts.id as artifact_id,
              artifacts.name as artifact_name,
              artifacts.sha256 as bundle_sha256
         from projects
         join repositories
           on lower(repositories.owner || '/' || repositories.name) = lower(projects.github_repo_full_name)
         join release_runs
           on release_runs.repository_id = repositories.id
          and release_runs.status = 'completed'
          and release_runs.decision = 'pass'
          and release_runs.completed_at is not null
         join artifacts
           on artifacts.run_id = release_runs.id
          and artifacts.role = 'manufacturing'
          and artifacts.kind = 'archive'
          and artifacts.bytes > 0
          and artifacts.sha256 ~ '^[0-9a-f]{64}$'
        where projects.workspace_id = $1
          and projects.github_repo_full_name is not null
          and not exists (
            select 1 from revisions where revisions.validation_artifact_id = artifacts.id
          )
        order by release_runs.completed_at desc, artifacts.id desc
        limit $2`,
      [workspaceId, limit],
    )) as {
      rows?: {
        project_id: string;
        project_name: string;
        run_id: string;
        commit_sha: string;
        completed_at: string | Date;
        artifact_id: string;
        artifact_name: string;
        bundle_sha256: string;
      }[];
    };

    return (result?.rows ?? []).map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      runId: row.run_id,
      commitSha: row.commit_sha,
      completedAt: new Date(row.completed_at).toISOString(),
      artifactId: row.artifact_id,
      artifactName: row.artifact_name,
      bundleSha256: row.bundle_sha256,
    }));
  }

  /**
   * Registers one validated manufacturing artifact as a workspace revision.
   *
   * Every relationship is re-checked in this insert-select, so a forged form cannot bind an
   * artifact from another repository/workspace or a run that did not complete with a pass.
   */
  async registerValidatedRevisionFromArtifact(input: {
    workspaceId: string;
    projectId: string;
    runId: string;
    artifactId: string;
    revisionLabel: string;
  }): Promise<RevisionRecord | null> {
    const id = `rev_${randomUUID()}`;
    const result = (await this.executor.query(
      `insert into revisions (
         id, project_id, revision_label, source_kind, commit_sha, bundle_sha256,
         normalized_summary, validation_run_id, validation_artifact_id
       )
       select $1,
              projects.id,
              $6,
              'github_commit',
              release_runs.commit_sha,
              artifacts.sha256,
              jsonb_build_object(
                'validation', jsonb_build_object(
                  'source', 'release_run',
                  'status', 'validated',
                  'runId', release_runs.id,
                  'artifactId', artifacts.id,
                  'artifactName', artifacts.name
                )
              ),
              release_runs.id,
              artifacts.id
         from projects
         join repositories
           on lower(repositories.owner || '/' || repositories.name) = lower(projects.github_repo_full_name)
         join release_runs
           on release_runs.repository_id = repositories.id
          and release_runs.id = $4
          and release_runs.status = 'completed'
          and release_runs.decision = 'pass'
          and release_runs.completed_at is not null
         join artifacts
           on artifacts.run_id = release_runs.id
          and artifacts.id = $5
          and artifacts.role = 'manufacturing'
          and artifacts.kind = 'archive'
          and artifacts.bytes > 0
          and artifacts.sha256 ~ '^[0-9a-f]{64}$'
        where projects.workspace_id = $2
          and projects.id = $3
          and projects.github_repo_full_name is not null
          and not exists (
            select 1 from revisions where revisions.validation_artifact_id = artifacts.id
          )
       returning id, project_id, revision_label, source_kind, commit_sha, bundle_sha256, normalized_summary,
                 validation_run_id, validation_artifact_id, created_at`,
      [id, input.workspaceId, input.projectId, input.runId, input.artifactId, input.revisionLabel],
    )) as { rows?: RevisionRow[] };

    const row = result?.rows?.[0];
    return row ? mapRevision(row) : null;
  }

  /**
   * Re-validates the evidence binding at delivery time rather than trusting revision metadata.
   */
  async revisionHasValidatedManufacturingEvidence(revisionId: string): Promise<boolean> {
    const result = (await this.executor.query(
      `select 1
         from revisions
         join release_runs
           on release_runs.id = revisions.validation_run_id
          and release_runs.status = 'completed'
          and release_runs.decision = 'pass'
          and release_runs.completed_at is not null
         join artifacts
           on artifacts.id = revisions.validation_artifact_id
          and artifacts.run_id = release_runs.id
          and artifacts.role = 'manufacturing'
          and artifacts.kind = 'archive'
          and artifacts.bytes > 0
        where revisions.id = $1
          and revisions.bundle_sha256 = artifacts.sha256
          and revisions.commit_sha = release_runs.commit_sha
        limit 1`,
      [revisionId],
    )) as { rows?: unknown[] };
    return (result?.rows ?? []).length > 0;
  }

  /** Every delivery link in a workspace, newest first. Excludes the token hash by construction. */
  async listDeliveriesByWorkspace(
    workspaceId: string,
    limit = 200,
    offset = 0,
  ): Promise<readonly WorkspaceDeliveryRecord[]> {
    const result = (await this.executor.query(
      `select deliveries.id, deliveries.revision_id, deliveries.expires_at,
              deliveries.signed_archive_url, deliveries.recipient_notes, deliveries.created_at,
              revisions.revision_label, projects.id as project_id, projects.name as project_name
         from deliveries
         join revisions on revisions.id = deliveries.revision_id
         join projects on projects.id = revisions.project_id
        where projects.workspace_id = $1
        order by deliveries.created_at desc, deliveries.id desc
        limit $2 offset $3`,
      [workspaceId, limit, offset],
    )) as {
      rows?: {
        id: string;
        revision_id: string;
        expires_at: string | Date;
        signed_archive_url: string;
        recipient_notes: string | null;
        created_at: string | Date;
        revision_label: string;
        project_id: string;
        project_name: string;
      }[];
    };

    return (result?.rows ?? []).map((row) => ({
      id: row.id,
      revisionId: row.revision_id,
      revisionLabel: row.revision_label,
      projectId: row.project_id,
      projectName: row.project_name,
      expiresAt: new Date(row.expires_at).toISOString(),
      signedArchiveUrl: row.signed_archive_url,
      ...(row.recipient_notes !== null ? { recipientNotes: row.recipient_notes } : {}),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  /**
   * Row counts for the three workspace listings that render as tables.
   *
   * One statement rather than three round trips: every page that needs one needs the others'
   * shape too (a table plus its page controls), and the three sub-selects are indexed.
   */
  async workspaceListingCounts(workspaceId: string): Promise<{
    projects: number;
    deliveries: number;
    members: number;
  }> {
    const result = (await this.executor.query(
      `select
         (select count(*) from projects where workspace_id = $1)::int as projects,
         (select count(*) from deliveries
            join revisions on revisions.id = deliveries.revision_id
            join projects on projects.id = revisions.project_id
           where projects.workspace_id = $1)::int as deliveries,
         (select count(*) from workspace_members where workspace_id = $1)::int as members`,
      [workspaceId],
    )) as { rows?: { projects: number; deliveries: number; members: number }[] };
    const row = result?.rows?.[0];
    return {
      projects: Number(row?.projects ?? 0),
      deliveries: Number(row?.deliveries ?? 0),
      members: Number(row?.members ?? 0),
    };
  }

  async createDeliveryLink(input: {
    id?: string | undefined;
    revisionId: string;
    expiresAt: Date | string;
    signedArchiveUrl: string;
    recipientNotes?: string | undefined;
    rawToken?: string | undefined;
  }): Promise<{ delivery: DeliveryRecord; rawToken: string }> {
    const id = input.id ?? `del_${randomUUID()}`;
    const rawToken = input.rawToken ?? randomBytes(32).toString("hex");
    const accessTokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(input.expiresAt).toISOString();

    const result = (await this.executor.query(
      `insert into deliveries (id, revision_id, access_token_hash, expires_at, signed_archive_url, recipient_notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id, revision_id, access_token_hash, expires_at, signed_archive_url, recipient_notes, created_at`,
      [id, input.revisionId, accessTokenHash, expiresAt, input.signedArchiveUrl, input.recipientNotes ?? null],
    )) as { rows?: DeliveryRow[] };

    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert delivery");
    }
    return {
      delivery: mapDelivery(row),
      rawToken,
    };
  }

  /**
   * What disappears if this workspace is deleted.
   *
   * `projects`, `revisions` and `deliveries` all cascade from `workspaces`, so a delete is far
   * more destructive than its button implies. A caller shows these counts before asking, rather
   * than letting someone discover the blast radius afterwards.
   */
  async workspaceDeletionImpact(workspaceId: string): Promise<{
    projects: number;
    revisions: number;
    deliveries: number;
  }> {
    const result = (await this.executor.query(
      `select
         (select count(*) from projects where workspace_id = $1)::int as projects,
         (select count(*) from revisions
            join projects on projects.id = revisions.project_id
           where projects.workspace_id = $1)::int as revisions,
         (select count(*) from deliveries
            join revisions on revisions.id = deliveries.revision_id
            join projects on projects.id = revisions.project_id
           where projects.workspace_id = $1)::int as deliveries`,
      [workspaceId],
    )) as { rows?: { projects: number; revisions: number; deliveries: number }[] };
    const row = result?.rows?.[0];
    return {
      projects: Number(row?.projects ?? 0),
      revisions: Number(row?.revisions ?? 0),
      deliveries: Number(row?.deliveries ?? 0),
    };
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<boolean> {
    const result = (await this.executor.query(`update workspaces set name = $2 where id = $1 returning id`, [
      workspaceId,
      name,
    ])) as { rows?: unknown[] };
    return (result?.rows ?? []).length > 0;
  }

  /** Removes the workspace and, by cascade, every project, revision and delivery beneath it. */
  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const result = (await this.executor.query(`delete from workspaces where id = $1 returning id`, [workspaceId])) as {
      rows?: unknown[];
    };
    return (result?.rows ?? []).length > 0;
  }

  /** What disappears if this project is deleted. Same reasoning as the workspace version. */
  async projectDeletionImpact(projectId: string): Promise<{ revisions: number; deliveries: number }> {
    const result = (await this.executor.query(
      `select
         (select count(*) from revisions where project_id = $1)::int as revisions,
         (select count(*) from deliveries
            join revisions on revisions.id = deliveries.revision_id
           where revisions.project_id = $1)::int as deliveries`,
      [projectId],
    )) as { rows?: { revisions: number; deliveries: number }[] };
    const row = result?.rows?.[0];
    return { revisions: Number(row?.revisions ?? 0), deliveries: Number(row?.deliveries ?? 0) };
  }

  async renameProject(projectId: string, name: string): Promise<boolean> {
    const result = (await this.executor.query(`update projects set name = $2 where id = $1 returning id`, [
      projectId,
      name,
    ])) as { rows?: unknown[] };
    return (result?.rows ?? []).length > 0;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const result = (await this.executor.query(`delete from projects where id = $1 returning id`, [projectId])) as {
      rows?: unknown[];
    };
    return (result?.rows ?? []).length > 0;
  }

  /**
   * Ends a guest delivery link now.
   *
   * Expires the link rather than deleting the row: `getDeliveryByToken` already refuses anything
   * past `expires_at`, so this closes access immediately while the record stays in place for the
   * audit trail — who shared what, and when it was withdrawn.
   */
  async revokeDeliveryLink(deliveryId: string): Promise<boolean> {
    const result = (await this.executor.query(
      `update deliveries set expires_at = now() where id = $1 and expires_at > now() returning id`,
      [deliveryId],
    )) as { rows?: unknown[] };
    return (result?.rows ?? []).length > 0;
  }

  /** The workspace a delivery belongs to, for authorizing a request that names only the delivery. */
  async workspaceIdForDelivery(deliveryId: string): Promise<string | null> {
    const result = (await this.executor.query(
      `select projects.workspace_id
         from deliveries
         join revisions on revisions.id = deliveries.revision_id
         join projects on projects.id = revisions.project_id
        where deliveries.id = $1`,
      [deliveryId],
    )) as { rows?: { workspace_id: string }[] };
    return result?.rows?.[0]?.workspace_id ?? null;
  }

  async getDeliveryByToken(rawToken: string): Promise<DeliveryRecord | null> {
    const accessTokenHash = createHash("sha256").update(rawToken).digest("hex");
    const result = (await this.executor.query(
      `select id, revision_id, access_token_hash, expires_at, signed_archive_url, recipient_notes, created_at
       from deliveries
       where access_token_hash = $1 and expires_at > now()`,
      [accessTokenHash],
    )) as { rows?: DeliveryRow[] };

    const row = result?.rows?.[0];
    return row ? mapDelivery(row) : null;
  }
}
