import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type WorkspacePlanTier = "community" | "team" | "business" | "pilot";

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  planTier: WorkspacePlanTier;
  stripeCustomerId?: string | undefined;
  createdAt: string;
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

  async createWorkspace(input: {
    id?: string | undefined;
    name: string;
    slug: string;
    planTier?: WorkspacePlanTier | undefined;
    stripeCustomerId?: string | undefined;
  }): Promise<WorkspaceRecord> {
    const id = input.id ?? `ws_${randomUUID()}`;
    const planTier = input.planTier ?? "community";
    const result = (await this.executor.query(
      `insert into workspaces (id, name, slug, plan_tier, stripe_customer_id)
       values ($1, $2, $3, $4, $5)
       returning id, name, slug, plan_tier, stripe_customer_id, created_at`,
      [id, input.name, input.slug, planTier, input.stripeCustomerId ?? null],
    )) as { rows?: WorkspaceRow[] };

    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert workspace");
    }
    return mapWorkspace(row);
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

  async listProjectsByWorkspace(workspaceId: string): Promise<ProjectRecord[]> {
    const result = (await this.executor.query(
      `select id, workspace_id, name, description, default_cad_format, github_repo_full_name, created_at
       from projects
       where workspace_id = $1
       order by created_at desc`,
      [workspaceId],
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
