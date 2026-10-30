import { createHash, randomUUID } from "node:crypto";
import { DataExportInventoryStore } from "./data-export-inventory.js";
import { type PreparedExportManifest, prepareClaimedExportManifest } from "./data-export-manifest.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export class ExportPreparationInputError extends Error {
  constructor() {
    super("Invalid export preparation scope, installation, or worker identity.");
    this.name = "ExportPreparationInputError";
  }
}

type BoundExportScope = "organization" | "repository";
export type ExportPreparationClaim = {
  exportId: string;
  installationId: string;
  tenantId: string;
  scope: BoundExportScope;
  scopeId: string | null;
  workerId: string;
  token: string;
  leaseUntil: string;
  attemptCount: number;
};

function canonical(value: string, maximum = 128): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value;
}

function validWorker(value: string): boolean {
  return canonical(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? value : [];
}

/**
 * Only prepares explicitly installation-bound export requests. An expired
 * reservation is NOT automatically reclaimed: it may have an unknown external
 * outcome and must be inspected before a future operator recovery feature.
 *
 * No public HTTP route or automatic worker is connected to this store.
 */
export class DataExportPreparationStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async createBoundPendingExport(input: {
    tenantId: string;
    installationId: string;
    requestedBy: string;
    scope: BoundExportScope;
    scopeId?: string | null;
  }): Promise<string | null> {
    if (
      !canonical(input.tenantId, 256) ||
      !canonical(input.installationId) ||
      !canonical(input.requestedBy, 256) ||
      (input.scope !== "organization" && input.scope !== "repository") ||
      (input.scope === "organization" && input.scopeId != null) ||
      (input.scope === "repository" && !canonical(input.scopeId ?? ""))
    )
      throw new ExportPreparationInputError();

    const id = randomUUID();
    const result = await this.db.query(
      `WITH owned_installation AS (
         SELECT id, account_login
           FROM installations
          WHERE id = $2
            AND lower(account_login) = lower($3)
            AND suspended_at IS NULL
       )
       INSERT INTO data_exports (id, tenant_id, installation_id, requested_by, status, scope, scope_id, created_at)
       SELECT $1, owned_installation.account_login, owned_installation.id, $4, 'pending', $5, $6, NOW()
         FROM owned_installation
        WHERE $5 = 'organization'
           OR ($5 = 'repository' AND EXISTS (
             SELECT 1 FROM repositories
              WHERE repositories.id = $6
                AND repositories.installation_id = owned_installation.id
                AND repositories.disabled_at IS NULL
           ))
       RETURNING id`,
      [id, input.installationId, input.tenantId, input.requestedBy, input.scope, input.scopeId ?? null],
    );
    const row = rows(result)[0];
    return typeof row?.id === "string" ? row.id : null;
  }

  /**
   * Atomic SKIP LOCKED reservation. Claiming does NOT mean archive delivery.
   * Existing unbound requests, unavailable scopes and suspended installations
   * are not candidates; running/expired reservations are never reclaimed.
   */
  async claimNext(input: { installationId: string; workerId: string }): Promise<ExportPreparationClaim | null> {
    if (!canonical(input.installationId) || !validWorker(input.workerId)) throw new ExportPreparationInputError();
    const result = await this.db.query(
      `WITH candidate AS (
         SELECT data_exports.id
           FROM data_exports
           JOIN installations ON installations.id = data_exports.installation_id
          WHERE data_exports.installation_id = $1
            AND data_exports.status = 'pending'
            AND data_exports.prepared_manifest_bytes IS NULL
            AND installations.suspended_at IS NULL
            AND lower(installations.account_login) = lower(data_exports.tenant_id)
            AND (
              (data_exports.scope = 'organization' AND data_exports.scope_id IS NULL)
              OR (data_exports.scope = 'repository' AND EXISTS (
                SELECT 1 FROM repositories
                 WHERE repositories.id = data_exports.scope_id
                   AND repositories.installation_id = installations.id
                   AND repositories.disabled_at IS NULL
              ))
            )
          ORDER BY data_exports.created_at, data_exports.id
          FOR UPDATE OF data_exports SKIP LOCKED
          LIMIT 1
       )
       UPDATE data_exports
          SET status = 'running',
              preparation_worker = $2,
              preparation_token = gen_random_uuid()::text,
              preparation_lease_until = NOW() + interval '2 minutes',
              preparation_attempts = preparation_attempts + 1
         FROM candidate
        WHERE data_exports.id = candidate.id
       RETURNING data_exports.id, data_exports.installation_id,
                 data_exports.tenant_id, data_exports.scope, data_exports.scope_id,
                 data_exports.preparation_worker, data_exports.preparation_token,
                 data_exports.preparation_lease_until, data_exports.preparation_attempts`,
      [input.installationId, input.workerId],
    );
    const r = rows(result)[0];
    if (!r) return null;
    if (
      typeof r.id !== "string" ||
      r.installation_id !== input.installationId ||
      typeof r.tenant_id !== "string" ||
      (r.scope !== "organization" && r.scope !== "repository") ||
      r.preparation_worker !== input.workerId ||
      typeof r.preparation_token !== "string" ||
      !(r.preparation_lease_until instanceof Date || typeof r.preparation_lease_until === "string") ||
      typeof r.preparation_attempts !== "number"
    )
      throw new Error("Incomplete preparation reservation");
    return {
      exportId: r.id,
      installationId: input.installationId,
      tenantId: r.tenant_id,
      scope: r.scope,
      scopeId: typeof r.scope_id === "string" ? r.scope_id : null,
      workerId: input.workerId,
      token: r.preparation_token,
      leaseUntil: new Date(r.preparation_lease_until).toISOString(),
      attemptCount: r.preparation_attempts,
    };
  }

  /**
   * Stage a bounded allowlisted manifest durably inside the existing DB.
   * This deliberately leaves status RUNNING: staging is NOT completion, a
   * customer export, or permission to download. Expired/crashed reservations
   * remain quarantined for explicit operator recovery instead of auto-retry.
   */
  async stageClaimedManifest(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
    workerId: string;
    token: string;
  }): Promise<{ sha256: string; byteLength: number } | null> {
    if (
      ![input.exportId, input.tenantId, input.installationId, input.token].every((s) => canonical(s)) ||
      !validWorker(input.workerId)
    )
      throw new ExportPreparationInputError();
    const prepared = await prepareClaimedExportManifest(new DataExportInventoryStore(this.db), input);
    if (!prepared) return null;
    const result = await this.db.query(
      `UPDATE data_exports
          SET prepared_manifest_bytes = $6,
              prepared_manifest_sha256 = $7,
              prepared_manifest_at = NOW()
        WHERE id = $1
          AND lower(tenant_id) = lower($2)
          AND installation_id = $3
          AND status = 'running'
          AND preparation_worker = $4
          AND preparation_token = $5
          AND preparation_lease_until > NOW()
          AND prepared_manifest_bytes IS NULL
          AND EXISTS (
            SELECT 1 FROM installations
             WHERE installations.id = data_exports.installation_id
               AND installations.suspended_at IS NULL
               AND lower(installations.account_login) = lower(data_exports.tenant_id)
               AND (
                 (data_exports.scope = 'organization' AND data_exports.scope_id IS NULL)
                 OR (data_exports.scope = 'repository' AND EXISTS (
                   SELECT 1 FROM repositories
                    WHERE repositories.id = data_exports.scope_id
                      AND repositories.installation_id = installations.id
                      AND repositories.disabled_at IS NULL
                 ))
               )
          )
       RETURNING id`,
      [
        input.exportId,
        input.tenantId,
        input.installationId,
        input.workerId,
        input.token,
        prepared.bytes,
        prepared.sha256,
      ],
    );
    if (rows(result).length !== 1) return null;
    // Verify actual persisted bytes and digest, never call this "completed".
    const persisted = await this.readStagedManifest(input);
    if (!persisted || persisted.sha256 !== prepared.sha256 || persisted.byteLength !== prepared.byteLength)
      throw new Error("Persisted export manifest failed integrity verification");
    return { sha256: persisted.sha256, byteLength: persisted.byteLength };
  }

  /** Operator-owned lease readback only; not exposed as a customer download. */
  async readStagedManifest(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
    workerId: string;
    token: string;
  }): Promise<PreparedExportManifest | null> {
    if (
      ![input.exportId, input.tenantId, input.installationId, input.token].every((s) => canonical(s)) ||
      !validWorker(input.workerId)
    )
      throw new ExportPreparationInputError();
    const result = await this.db.query(
      `SELECT data_exports.prepared_manifest_bytes, data_exports.prepared_manifest_sha256
         FROM data_exports
         JOIN installations ON installations.id = data_exports.installation_id
        WHERE data_exports.id = $1
          AND lower(data_exports.tenant_id) = lower($2)
          AND data_exports.installation_id = $3
          AND data_exports.status = 'running'
          AND data_exports.preparation_worker = $4
          AND data_exports.preparation_token = $5
          AND data_exports.preparation_lease_until > NOW()
          AND installations.suspended_at IS NULL
          AND lower(installations.account_login) = lower(data_exports.tenant_id)
          AND (
            (data_exports.scope = 'organization' AND data_exports.scope_id IS NULL)
            OR (data_exports.scope = 'repository' AND EXISTS (
              SELECT 1 FROM repositories
               WHERE repositories.id = data_exports.scope_id
                 AND repositories.installation_id = installations.id
                 AND repositories.disabled_at IS NULL
            ))
          )`,
      [input.exportId, input.tenantId, input.installationId, input.workerId, input.token],
    );
    const row = rows(result)[0];
    if (!row) return null;
    const bytes = row.prepared_manifest_bytes;
    const sha256 = row.prepared_manifest_sha256;
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length === 0 ||
      bytes.length > 65536 ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      createHash("sha256").update(bytes).digest("hex") !== sha256
    )
      throw new Error("Persisted export manifest failed integrity verification");
    return { bytes, sha256, byteLength: bytes.length, contentType: "application/json" };
  }

  /**
   * Only current, unexpired owner can release a READ-ONLY preparation lease.
   * A crash/expired lease remains quarantined as running; no blind retry.
   * Never marks an export completed or produces a downloadable capability.
   */
  async releaseReadOnlyClaim(input: {
    exportId: string;
    installationId: string;
    workerId: string;
    token: string;
  }): Promise<boolean> {
    if (![input.exportId, input.installationId, input.workerId, input.token].every((x) => canonical(x))) {
      throw new ExportPreparationInputError();
    }
    const result = await this.db.query(
      `UPDATE data_exports
          SET status = 'pending',
              preparation_worker = NULL,
              preparation_token = NULL,
              preparation_lease_until = NULL
        WHERE id = $1
          AND installation_id = $2
          AND status = 'running'
          AND preparation_worker = $3
          AND preparation_token = $4
          AND preparation_lease_until > NOW()
          AND prepared_manifest_bytes IS NULL
          AND EXISTS (
            SELECT 1 FROM installations
             WHERE installations.id = data_exports.installation_id
               AND installations.suspended_at IS NULL
               AND lower(installations.account_login) = lower(data_exports.tenant_id)
          )
       RETURNING id`,
      [input.exportId, input.installationId, input.workerId, input.token],
    );
    return rows(result).length === 1;
  }
}
