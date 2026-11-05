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
      `INSERT INTO data_export_archive_commitments (
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
       RETURNING archive_sha256, archive_byte_length, archive_files, expires_at`,
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
  async readForRequester(input: {
    exportId: string;
    tenantId: string;
    installationId: string;
    actorLogin: string;
  }): Promise<StagedArchiveCommitment | null> {
    if (![input?.exportId, input?.tenantId, input?.installationId, input?.actorLogin].every(canonical)) return null;
    const result = await this.db.query(
      `SELECT commitment.archive_sha256, commitment.archive_byte_length,
              commitment.archive_files, commitment.expires_at
         FROM data_export_archive_commitments AS commitment
         JOIN data_exports AS exports ON exports.id = commitment.export_id
         JOIN installations ON installations.id = exports.installation_id
        WHERE exports.id = $1 AND lower(exports.tenant_id) = lower($2)
          AND exports.installation_id = $3 AND commitment.installation_id = installations.id
          AND lower(exports.requested_by) = lower($4)
          AND exports.status = 'running'
          AND exports.preparation_lease_until > NOW()
          AND commitment.expires_at > NOW() AND commitment.revoked_at IS NULL
          AND installations.suspended_at IS NULL
          AND lower(installations.account_login) = lower(exports.tenant_id)
          AND ((exports.scope = 'organization' AND exports.scope_id IS NULL)
            OR (exports.scope = 'repository' AND EXISTS (
              SELECT 1 FROM repositories WHERE repositories.id = exports.scope_id
                AND repositories.installation_id = installations.id
                AND repositories.disabled_at IS NULL)))
        LIMIT 1`,
      [input.exportId, input.tenantId, input.installationId, input.actorLogin],
    );
    return checkedRow(rows(result)[0]);
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
      `UPDATE data_export_archive_commitments AS commitment
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
       RETURNING commitment.export_id`,
      [input.exportId, input.tenantId, input.installationId, input.actorLogin],
    );
    return rows(result).length === 1;
  }
}
