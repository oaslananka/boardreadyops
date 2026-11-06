import { isValidExportSha256 } from "./data-export-hex-digest.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

const maxArchiveBytes = 64 * 1024 * 1024;
type Claim = {
  exportId: string;
  tenantId: string;
  installationId: string;
  workerId: string;
  token: string;
};
export type StagedArchiveCommitment = {
  sha256: string;
  byteLength: number;
  files: number;
  expiresAt: string;
};

const canonical = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
const validClaim = (claim: Claim): boolean =>
  [claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token].every(canonical) &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(claim.workerId);
function rows(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const values = (result as { rows?: unknown }).rows;
  return Array.isArray(values) ? values : [];
}
function checkedRow(row: Record<string, unknown> | undefined): StagedArchiveCommitment | null {
  if (!row) return null;
  const sha = row.archive_sha256;
  const size = row.archive_byte_length;
  const files = row.archive_files;
  const expiry = row.expires_at;
  if (
    !isValidExportSha256(sha) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > maxArchiveBytes ||
    typeof files !== "number" ||
    !Number.isSafeInteger(files) ||
    files < 8 ||
    files > 108 ||
    !(expiry instanceof Date || typeof expiry === "string")
  ) {
    throw new Error("Invalid persisted archive commitment");
  }
  const expiresAt = new Date(expiry).toISOString();
  return { sha256: sha, byteLength: size, files, expiresAt };
}

type ArchiveRequester = {
  exportId: string;
  tenantId: string;
  installationId: string;
  actorLogin: string;
};
const validRequester = (input: ArchiveRequester): boolean =>
  Boolean(input) && [input.exportId, input.tenantId, input.installationId, input.actorLogin].every(canonical);

// One canonical scope predicate for both the initial read and its final
// audit-coupled attestation. The worker lease protects staging, NOT the
// original requester's fifteen-minute, separately revocable read window.
const authorizedRequesterSelect = `SELECT commitment.export_id, commitment.installation_id,
       commitment.archive_sha256, commitment.archive_byte_length,
       commitment.archive_files, commitment.expires_at
  FROM data_export_archive_commitments AS commitment
  JOIN data_exports AS exports ON exports.id = commitment.export_id
  JOIN installations ON installations.id = exports.installation_id
 WHERE exports.id = $1 AND lower(exports.tenant_id) = lower($2)
   AND exports.installation_id = $3 AND commitment.installation_id = installations.id
   AND lower(exports.requested_by) = lower($4)
   AND exports.status = 'running'
   AND commitment.expires_at > NOW() AND commitment.revoked_at IS NULL
   AND commitment.cleaned_at IS NULL
   AND installations.suspended_at IS NULL
   AND lower(installations.account_login) = lower(exports.tenant_id)
   AND ((exports.scope = 'organization' AND exports.scope_id IS NULL)
     OR (exports.scope = 'repository' AND EXISTS (
       SELECT 1 FROM repositories WHERE repositories.id = exports.scope_id
         AND repositories.installation_id = installations.id
         AND repositories.disabled_at IS NULL)))`;

/**
 * Internal publication PREPARATION: a one-time immutable commitment to a
 * separately assembled and verified ZIP, under the original active worker lease.
 * It never stores customer bytes, publishes a URL, marks a data export complete,
 * or authorizes a download. An expired reservation is not auto-reclaimed.
 */
export class DataExportArchiveCommitmentStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async stage(
    claim: Claim,
    archive: { sha256: string; byteLength: number; files: number },
  ): Promise<StagedArchiveCommitment | null> {
    if (
      !claim ||
      !validClaim(claim) ||
      !archive ||
      !isValidExportSha256(archive.sha256) ||
      !Number.isSafeInteger(archive.byteLength) ||
      archive.byteLength < 1 ||
      archive.byteLength > maxArchiveBytes ||
      !Number.isSafeInteger(archive.files) ||
      archive.files < 8 ||
      archive.files > 108
    ) {
      return null;
    }
    const result = await this.db.query(
      `WITH staged AS (
       INSERT INTO data_export_archive_commitments (
         export_id, installation_id, archive_sha256, archive_byte_length,
         archive_files, staged_at, expires_at
       )
       SELECT exports.id, installations.id, $6, $7, $8, NOW(), NOW() + interval '15 minutes'
         FROM data_exports AS exports
         JOIN installations ON installations.id = exports.installation_id
        WHERE exports.id = $1 AND lower(exports.tenant_id) = lower($2)
          AND exports.installation_id = $3
          AND exports.status = 'running'
          AND exports.preparation_worker = $4 AND exports.preparation_token = $5
          AND exports.preparation_lease_until > NOW()
          AND installations.suspended_at IS NULL
          AND lower(installations.account_login) = lower(exports.tenant_id)
          AND ((exports.scope = 'organization' AND exports.scope_id IS NULL)
            OR (exports.scope = 'repository' AND EXISTS (
              SELECT 1 FROM repositories WHERE repositories.id = exports.scope_id
                AND repositories.installation_id = installations.id
                AND repositories.disabled_at IS NULL)))
       ON CONFLICT (export_id) DO NOTHING
       RETURNING export_id, installation_id, archive_sha256, archive_byte_length, archive_files, expires_at
       ), audited AS (
         INSERT INTO audit_events (
           installation_id, event_type, actor_type, actor_id,
           subject_type, subject_id, metadata
         )
         SELECT staged.installation_id, 'data_export.archive.staged',
                'system', $4, 'data_export', staged.export_id,
                jsonb_build_object(
                  'sha256', staged.archive_sha256,
                  'byteLength', staged.archive_byte_length,
                  'fileCount', staged.archive_files,
                  'expiresAt', staged.expires_at
                )
           FROM staged
         RETURNING id
       )
       SELECT staged.archive_sha256, staged.archive_byte_length,
              staged.archive_files, staged.expires_at
         FROM staged CROSS JOIN audited`,
      [
        claim.exportId,
        claim.tenantId,
        claim.installationId,
        claim.workerId,
        claim.token,
        archive.sha256,
        archive.byteLength,
        archive.files,
      ],
    );
    return checkedRow(rows(result)[0]);
  }

  /** Read-only original-requester admission; NOT a ZIP or download capability. */
  async readForRequester(input: ArchiveRequester): Promise<StagedArchiveCommitment | null> {
    if (!validRequester(input)) return null;
    const result = await this.db.query(`${authorizedRequesterSelect} LIMIT 1`, [
      input.exportId,
      input.tenantId,
      input.installationId,
      input.actorLogin,
    ]);
    return checkedRow(rows(result)[0]);
  }

  /**
   * Atomically rechecks original-requester authority and appends an immutable
   * "verified private read" audit event. Called ONLY after bytes have passed
   * independent file-digest and ZIP-manifest verification, never by a public
   * customer HTTP endpoint. A row lock serializes this final admission with
   * concurrent commitment revocation within the statement. It does NOT
   * serialize future response streaming or prove customer download.
   */
  async auditVerifiedReadForRequester(
    input: ArchiveRequester,
    verified: StagedArchiveCommitment,
  ): Promise<StagedArchiveCommitment | null> {
    if (
      !validRequester(input) ||
      !verified ||
      !isValidExportSha256(verified.sha256) ||
      !Number.isSafeInteger(verified.byteLength) ||
      verified.byteLength < 1 ||
      verified.byteLength > maxArchiveBytes ||
      !Number.isSafeInteger(verified.files) ||
      verified.files < 8 ||
      verified.files > 108 ||
      typeof verified.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(verified.expiresAt))
    )
      return null;
    const result = await this.db.query(
      `WITH allowed AS MATERIALIZED (
         ${authorizedRequesterSelect}
         AND commitment.archive_sha256 = $5
         AND commitment.archive_byte_length = $6
         AND commitment.archive_files = $7
         AND date_trunc('milliseconds', commitment.expires_at) = $8::timestamptz
         LIMIT 1 FOR SHARE OF commitment
       ), audited AS (
         INSERT INTO audit_events (
           installation_id, event_type, actor_type, actor_login,
           subject_type, subject_id, metadata
         )
         SELECT allowed.installation_id, 'data_export.archive.read_verified',
                'user', $4, 'data_export', allowed.export_id,
                jsonb_build_object(
                  'sha256', allowed.archive_sha256,
                  'byteLength', allowed.archive_byte_length,
                  'fileCount', allowed.archive_files
                )
           FROM allowed
         RETURNING id
       )
       SELECT allowed.archive_sha256, allowed.archive_byte_length,
              allowed.archive_files, allowed.expires_at
         FROM allowed CROSS JOIN audited`,
      [
        input.exportId,
        input.tenantId,
        input.installationId,
        input.actorLogin,
        verified.sha256,
        verified.byteLength,
        verified.files,
        verified.expiresAt,
      ],
    );
    return checkedRow(rows(result)[0]);
  }

  /**
   * Internal retention REVIEW only: decide whether a known, original-bound
   * archive is still active, on hold, or may be inspected for cleanup.
   *
   * Any active tenant hold blocks review, including cross-scope holds, since
   * an organization export can contain repository and user records. A missing
   * DB commitment, removed installation, or unbound orphan is never silently
   * considered deletable. This is not a deletion permit: a future janitor
   * MUST recheck holds, DB state, and filesystem identity atomically before
   * taking any destructive action.
   */
  async previewRetention(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
  }): Promise<"active" | "hold" | "cleanup_review" | "cleaned" | null> {
    if (![input?.exportId, input?.tenantId, input?.installationId].every(canonical)) return null;
    const result = await this.db.query(
      `SELECT CASE
           WHEN commitment.cleaned_at IS NOT NULL THEN 'cleaned'
           WHEN EXISTS (
             SELECT 1 FROM legal_holds AS holds
              WHERE lower(holds.tenant_id) = lower(exports.tenant_id)
                AND holds.active = TRUE
           ) THEN 'hold'
           WHEN commitment.revoked_at IS NULL AND commitment.expires_at > NOW()
             THEN 'active'
           ELSE 'cleanup_review'
         END AS retention_disposition
         FROM data_export_archive_commitments AS commitment
         JOIN data_exports AS exports ON exports.id = commitment.export_id
         JOIN installations ON installations.id = exports.installation_id
        WHERE commitment.export_id = $1
          AND lower(exports.tenant_id) = lower($2)
          AND exports.installation_id = $3
          AND commitment.installation_id = installations.id
          AND lower(installations.account_login) = lower(exports.tenant_id)
        LIMIT 1`,
      [input.exportId, input.tenantId, input.installationId],
    );
    const disposition = rows(result)[0]?.retention_disposition;
    if (
      disposition === "active" ||
      disposition === "hold" ||
      disposition === "cleanup_review" ||
      disposition === "cleaned"
    ) {
      return disposition;
    }
    return null;
  }

  /**
   * INTERNAL physical cleanup fence, never callable with an unbound orphan.
   * Lock the legal-hold table against concurrent INSERT/UPDATE/DELETE for the
   * short-lived filesystem operation. A conflicting hold writer fails NOWAIT,
   * without touching bytes. Keep this and cleanup marker in ONE transaction.
   *
   * The caller MUST pass the pinned transactional query executor, not a pool.
   */
  async lockCleanupCandidate(input: { exportId: string; tenantId: string; installationId: string }): Promise<{
    sha256: string;
    byteLength: number;
    disposition: "active" | "hold" | "cleaned" | "eligible";
  } | null> {
    if (![input?.exportId, input?.tenantId, input?.installationId].every(canonical)) return null;
    await this.db.query("LOCK TABLE legal_holds IN SHARE MODE NOWAIT");
    const result = await this.db.query(
      `SELECT commitment.archive_sha256, commitment.archive_byte_length,
          commitment.expires_at, commitment.revoked_at, commitment.cleaned_at,
          EXISTS (
            SELECT 1 FROM legal_holds
             WHERE lower(tenant_id)=lower(exports.tenant_id) AND active=TRUE
          ) AS has_hold
         FROM data_export_archive_commitments AS commitment
         JOIN data_exports AS exports ON exports.id=commitment.export_id
         JOIN installations ON installations.id=exports.installation_id
        WHERE commitment.export_id=$1 AND lower(exports.tenant_id)=lower($2)
          AND exports.installation_id=$3
          AND commitment.installation_id=installations.id
          AND lower(installations.account_login)=lower(exports.tenant_id)
        LIMIT 1 FOR UPDATE OF commitment`,
      [input.exportId, input.tenantId, input.installationId],
    );
    const row = rows(result)[0];
    if (
      !row ||
      !isValidExportSha256(row.archive_sha256) ||
      !Number.isSafeInteger(row.archive_byte_length) ||
      (row.archive_byte_length as number) < 1 ||
      (row.archive_byte_length as number) > maxArchiveBytes
    )
      return null;
    let disposition: "cleaned" | "hold" | "eligible" | "active" = "active";
    if (row.cleaned_at != null) {
      disposition = "cleaned";
    } else if (row.has_hold === true) {
      disposition = "hold";
    } else if (row.revoked_at != null || Date.parse(String(row.expires_at)) <= Date.now()) {
      disposition = "eligible";
    }
    return {
      sha256: row.archive_sha256,
      byteLength: row.archive_byte_length as number,
      disposition,
    };
  }

  /**
   * Audited cleanup marker called only after the physical unlink (or confirmed
   * missing file) while the SAME transaction holds the commitment + legal-hold
   * locks. Audit history and immutable original digest are never removed.
   */
  async markPhysicallyCleaned(
    input: { exportId: string; tenantId: string; installationId: string },
    result: "deleted" | "missing",
  ): Promise<void> {
    if (
      ![input?.exportId, input?.tenantId, input?.installationId].every(canonical) ||
      (result !== "deleted" && result !== "missing")
    )
      throw new Error("Invalid archive cleanup scope");
    const recorded = await this.db.query(
      `WITH cleaned AS (
         UPDATE data_export_archive_commitments AS commitment
            SET cleaned_at=NOW(), cleanup_result=$4
           FROM data_exports AS exports
           JOIN installations ON installations.id=exports.installation_id
          WHERE commitment.export_id=$1 AND exports.id=commitment.export_id
            AND lower(exports.tenant_id)=lower($2)
            AND exports.installation_id=$3 AND commitment.installation_id=installations.id
            AND lower(installations.account_login)=lower(exports.tenant_id)
            AND commitment.cleaned_at IS NULL
            AND (commitment.revoked_at IS NOT NULL OR commitment.expires_at <= NOW())
            AND NOT EXISTS (
              SELECT 1 FROM legal_holds
               WHERE lower(tenant_id)=lower(exports.tenant_id) AND active=TRUE
            )
         RETURNING commitment.export_id, commitment.installation_id, commitment.archive_sha256
       ), audited AS (
         INSERT INTO audit_events (
           installation_id,event_type,actor_type,actor_id,subject_type,subject_id,metadata
         )
         SELECT cleaned.installation_id, 'data_export.archive.cleaned',
                'system','archive-retention','data_export',cleaned.export_id,
                jsonb_build_object('outcome',$4::text,'sha256',cleaned.archive_sha256)
           FROM cleaned
         RETURNING id
       )
       SELECT cleaned.export_id FROM cleaned CROSS JOIN audited`,
      [input.exportId, input.tenantId, input.installationId, result],
    );
    if (rows(recorded).length !== 1) throw new Error("Archive cleanup transaction lost eligibility");
  }

  /** One-way requester revocation, scoped to an active installation. */
  async revokeForRequester(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
    actorLogin: string;
  }): Promise<boolean> {
    if (![input?.exportId, input?.tenantId, input?.installationId, input?.actorLogin].every(canonical)) return false;
    const result = await this.db.query(
      `WITH revoked AS (
       UPDATE data_export_archive_commitments AS commitment
          SET revoked_at = NOW()
         FROM data_exports AS exports
         JOIN installations ON installations.id = exports.installation_id
        WHERE commitment.export_id = exports.id
          AND exports.id = $1 AND lower(exports.tenant_id) = lower($2)
          AND exports.installation_id = $3 AND commitment.installation_id = installations.id
          AND lower(exports.requested_by) = lower($4)
          AND commitment.revoked_at IS NULL
          AND installations.suspended_at IS NULL
          AND lower(installations.account_login) = lower(exports.tenant_id)
          AND ((exports.scope = 'organization' AND exports.scope_id IS NULL)
            OR (exports.scope = 'repository' AND EXISTS (
              SELECT 1 FROM repositories WHERE repositories.id = exports.scope_id
                AND repositories.installation_id = installations.id
                AND repositories.disabled_at IS NULL)))
       RETURNING commitment.export_id, commitment.installation_id
       ), audited AS (
         INSERT INTO audit_events (
           installation_id, event_type, actor_type, actor_login,
           subject_type, subject_id, metadata
         )
         SELECT revoked.installation_id, 'data_export.archive.revoked',
                'user', $4, 'data_export', revoked.export_id, '{}'::jsonb
           FROM revoked
         RETURNING id
       )
       SELECT revoked.export_id FROM revoked CROSS JOIN audited`,
      [input.exportId, input.tenantId, input.installationId, input.actorLogin],
    );
    return rows(result).length === 1;
  }
}
