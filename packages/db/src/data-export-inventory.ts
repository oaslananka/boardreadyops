import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * Read-only preparation for a future export package materializer.
 * This is intentionally NOT a complete tenant export, a completed request,
 * an archive, or permission to publish a download link.
 */
export type PendingExportInventory = {
  formatVersion: 1;
  exportId: string;
  tenantId: string;
  scope: "organization" | "repository";
  scopeId: string | null;
  coverage: "selected-installation-repositories-only";
  repositories: Array<{
    repositoryId: string;
    githubRepositoryId: string;
    owner: string;
    name: string;
    private: boolean;
    disabled: boolean;
  }>;
};

export class ExportInventoryUnavailableError extends Error {
  constructor() {
    super("This export scope cannot be safely inventoried.");
    this.name = "ExportInventoryUnavailableError";
  }
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}

type InventoryRow = {
  id: unknown;
  tenant_id: unknown;
  scope: unknown;
  scope_id: unknown;
  repositories: unknown;
};

export class DataExportInventoryStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  /**
   * The caller must already have authorized installationId for the current user.
   * This query independently ensures the persisted export tenant owns that active
   * installation, limits inventory to that installation and caps the result set.
   * Suspended/uninstalled installations and user-scoped exports remain unsupported.
   */
  async previewPendingExport(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
  }): Promise<PendingExportInventory | null> {
    return this.readScopedExport(input);
  }

  /**
   * A reservation can be read only by its current unexpired owner. The token,
   * installation, current tenant name, and status are checked together in SQL.
   * This creates bytes in memory only; no delivery permission is implied.
   */
  async previewClaimedExport(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
    workerId: string;
    token: string;
  }): Promise<PendingExportInventory | null> {
    return this.readScopedExport(input, { workerId: input.workerId, token: input.token });
  }

  private async readScopedExport(
    input: { exportId: string; tenantId: string; installationId: string },
    claim?: { workerId: string; token: string },
  ): Promise<PendingExportInventory | null> {
    if (
      ![input.exportId, input.tenantId, input.installationId].every(validIdentifier) ||
      (claim && ![claim.workerId, claim.token].every(validIdentifier))
    ) {
      throw new ExportInventoryUnavailableError();
    }
    const statusCondition = claim
      ? `data_exports.status = 'running'
            AND data_exports.installation_id = installations.id
            AND data_exports.preparation_worker = $4
            AND data_exports.preparation_token = $5
            AND data_exports.preparation_lease_until > NOW()`
      : "data_exports.status = 'pending'";
    const result = (await this.db.query(
      `WITH allowed_request AS MATERIALIZED (
         SELECT data_exports.id, data_exports.tenant_id, data_exports.scope,
                data_exports.scope_id, installations.id AS installation_id
           FROM data_exports
           JOIN installations
             ON installations.id = $3
            AND data_exports.installation_id = installations.id
            AND lower(installations.account_login) = lower(data_exports.tenant_id)
            AND installations.suspended_at IS NULL
          WHERE data_exports.id = $1
            AND lower(data_exports.tenant_id) = lower($2)
            AND ${statusCondition}
       ), selected_repositories AS (
         SELECT repositories.id, repositories.github_repo_id::text AS github_repo_id,
                repositories.owner, repositories.name, repositories.private,
                (repositories.disabled_at IS NOT NULL) AS disabled
           FROM repositories
           JOIN allowed_request ON repositories.installation_id = allowed_request.installation_id
          WHERE allowed_request.scope = 'organization'
             OR (allowed_request.scope = 'repository' AND repositories.id = allowed_request.scope_id)
          ORDER BY repositories.id
          LIMIT 101
       )
       SELECT allowed_request.id, allowed_request.tenant_id, allowed_request.scope,
              allowed_request.scope_id,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', selected_repositories.id,
                    'github_repo_id', selected_repositories.github_repo_id,
                    'owner', selected_repositories.owner,
                    'name', selected_repositories.name,
                    'private', selected_repositories.private,
                    'disabled', selected_repositories.disabled
                  ) ORDER BY selected_repositories.id
                ) FROM selected_repositories
              ), '[]'::jsonb) AS repositories
         FROM allowed_request`,
      [input.exportId, input.tenantId, input.installationId, ...(claim ? [claim.workerId, claim.token] : [])],
    )) as { rows?: InventoryRow[] };

    const row = result.rows?.[0];
    if (!row) return null;
    if (
      typeof row.id !== "string" ||
      typeof row.tenant_id !== "string" ||
      (row.scope !== "organization" && row.scope !== "repository") ||
      !Array.isArray(row.repositories) ||
      row.repositories.length > 100
    ) {
      throw new ExportInventoryUnavailableError();
    }
    if (
      (row.scope === "organization" && row.scope_id !== null) ||
      (row.scope === "repository" && (typeof row.scope_id !== "string" || row.repositories.length !== 1))
    ) {
      throw new ExportInventoryUnavailableError();
    }

    const repositories = row.repositories.map((item: unknown) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("id" in item) ||
        typeof item.id !== "string" ||
        !("github_repo_id" in item) ||
        typeof item.github_repo_id !== "string" ||
        !("owner" in item) ||
        typeof item.owner !== "string" ||
        !("name" in item) ||
        typeof item.name !== "string" ||
        !("private" in item) ||
        typeof item.private !== "boolean" ||
        !("disabled" in item) ||
        typeof item.disabled !== "boolean"
      ) {
        throw new ExportInventoryUnavailableError();
      }
      return {
        repositoryId: item.id,
        githubRepositoryId: item.github_repo_id,
        owner: item.owner,
        name: item.name,
        private: item.private,
        disabled: item.disabled,
      };
    });
    return {
      formatVersion: 1,
      exportId: row.id,
      tenantId: row.tenant_id,
      scope: row.scope,
      scopeId: row.scope === "repository" ? (row.scope_id as string) : null,
      coverage: "selected-installation-repositories-only",
      repositories,
    };
  }
}
