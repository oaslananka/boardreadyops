import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type WorkspacePlanTier = "community" | "team" | "business" | "pilot";

/** Matches the `workspace_members.role` check constraint in migration 0064. */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  planTier: WorkspacePlanTier;
  stripeCustomerId?: string | undefined;
  createdAt: string;
}

/** One person's membership of a workspace. `userId` is a GitHub login, the membership key. */
export interface WorkspaceMemberRecord {
  workspaceId: string;
  userId: string;
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
  createdAt: string;
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
         insert into workspace_members (workspace_id, user_id, role)
         select created.id, $6, 'owner' from created
       )
       select id, name, slug, plan_tier, stripe_customer_id, created_at from created`,
      [id, input.name, input.slug, planTier, input.stripeCustomerId ?? null, input.ownerUserId],
    )) as { rows?: WorkspaceRow[] };

    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert workspace");
    }
    return mapWorkspace(row);
  }

  /** The caller's role in a workspace, or `null` when they are not a member of it. */
  async workspaceRoleFor(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const result = (await this.executor.query(
      `select role from workspace_members where workspace_id = $1 and user_id = $2`,
      [workspaceId, userId],
    )) as { rows?: { role: string }[] };

    const role = result?.rows?.[0]?.role;
    return role === "owner" || role === "admin" || role === "member" || role === "viewer" ? role : null;
  }

  /** Every workspace the user belongs to, newest first. */
  async listWorkspacesForUser(userId: string): Promise<readonly WorkspaceMembershipRecord[]> {
    const result = (await this.executor.query(
      `select workspaces.id, workspaces.name, workspaces.slug, workspaces.plan_tier,
              workspaces.stripe_customer_id, workspaces.created_at, workspace_members.role
         from workspace_members
         join workspaces on workspaces.id = workspace_members.workspace_id
        where workspace_members.user_id = $1
        order by workspaces.created_at desc, workspaces.id desc`,
      [userId],
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
      `select workspace_id, user_id, role, created_at
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
    )) as { rows?: { workspace_id: string; user_id: string; role: string; created_at: string | Date }[] };

    return (result?.rows ?? []).map((row) => ({
      workspaceId: row.workspace_id,
      userId: row.user_id,
      role: (row.role === "owner" || row.role === "admin" || row.role === "member"
        ? row.role
        : "viewer") as WorkspaceRole,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  /**
   * Grants or changes access. Idempotent on the primary key, so re-adding someone updates their
   * role rather than failing -- which is what "add them as an admin" means when they are already
   * a member.
   *
   * There is no invitation step: `workspace_members.user_id` is a GitHub login, and the row takes
   * effect the moment that person signs in. Callers must say so.
   */
  async upsertWorkspaceMember(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<WorkspaceMemberRecord> {
    const result = (await this.executor.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, $3)
       on conflict (workspace_id, user_id) do update set role = excluded.role
       returning workspace_id, user_id, role, created_at`,
      [input.workspaceId, input.userId, input.role],
    )) as { rows?: { workspace_id: string; user_id: string; role: string; created_at: string | Date }[] };

    const row = result?.rows?.[0];
    if (!row) throw new Error("Failed to upsert workspace member");
    return {
      workspaceId: row.workspace_id,
      userId: row.user_id,
      role: input.role,
      createdAt: new Date(row.created_at).toISOString(),
    };
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
  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = (await this.executor.query(
      `delete from workspace_members
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
       returning user_id`,
      [workspaceId, userId],
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
       returning id, project_id, revision_label, source_kind, commit_sha, bundle_sha256, normalized_summary, created_at`,
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
      `select id, project_id, revision_label, source_kind, commit_sha, bundle_sha256, normalized_summary, created_at
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
