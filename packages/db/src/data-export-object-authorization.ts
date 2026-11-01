import { randomUUID } from "node:crypto";
import type { ExportRecordClaim } from "./data-export-record-snapshot.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/** An internal, read-only object locator; NEVER a customer-facing capability. */
export type ClaimedExportObject = {
  artifactId: string;
  runId: string;
  repositoryId: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
};

const validIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;

/**
 * Rechecks the original installation-bound, unexpired worker lease and a
 * single artifact's actual repository ownership at the time of the query.
 * Only artifacts with an explicit FUTURE retention deadline can be read;
 * unknown deadlines are intentionally unavailable until policy is resolved.
 * A deletion job for the physical path blocks all reads, regardless of job
 * status; this conservative fence prevents a queued unlink being mistaken
 * for a still-exportable physical object.
 *
 * Legal holds can retain bytes but do NOT bypass export expiry or authorize
 * a customer download. There are deliberately no writes or delivery URLs.
 */
export async function lookupClaimedExportObject(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
  artifactId: string,
): Promise<ClaimedExportObject | null> {
  if (
    ![claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token, artifactId].every(
      validIdentity,
    )
  )
    return null;
  const result = (await db.query(
    `SELECT artifact.id, artifact.run_id, repository.id AS repository_id,
            artifact.storage_path, artifact.sha256, artifact.bytes
       FROM data_exports AS exports
       JOIN installations AS installation ON installation.id = exports.installation_id
       JOIN artifacts AS artifact ON artifact.id = $6
       JOIN release_runs AS run ON run.id = artifact.run_id
       JOIN repositories AS repository ON repository.id = run.repository_id
      WHERE exports.id = $1 AND lower(exports.tenant_id) = lower($2)
        AND exports.installation_id = $3 AND exports.status = 'running'
        AND exports.preparation_worker = $4 AND exports.preparation_token = $5
        AND exports.preparation_lease_until > NOW()
        AND installation.suspended_at IS NULL
        AND lower(installation.account_login) = lower(exports.tenant_id)
        AND repository.installation_id = installation.id
        AND repository.disabled_at IS NULL
        AND ((exports.scope = 'organization' AND exports.scope_id IS NULL)
             OR (exports.scope = 'repository' AND exports.scope_id = repository.id))
        AND artifact.retention_until IS NOT NULL AND artifact.retention_until > NOW()
        AND NOT EXISTS (
          SELECT 1 FROM artifact_deletion_jobs AS job
          WHERE job.installation_id = installation.id AND job.storage_path = artifact.storage_path
        )
      LIMIT 1`,
    [claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token, artifactId],
  )) as { rows?: Array<Record<string, unknown>> };
  const row = result.rows?.[0];
  if (
    !row ||
    ![row.id, row.run_id, row.repository_id].every(validIdentity) ||
    row.id !== artifactId ||
    typeof row.storage_path !== "string" ||
    row.storage_path.length === 0 ||
    row.storage_path.length > 1024 ||
    row.storage_path.trim() !== row.storage_path ||
    typeof row.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.sha256) ||
    typeof row.bytes !== "number" ||
    !Number.isSafeInteger(row.bytes) ||
    row.bytes < 0 ||
    row.bytes > 64 * 1024 * 1024
  )
    return null;
  return {
    artifactId: row.id as string,
    runId: row.run_id as string,
    repositoryId: row.repository_id as string,
    storagePath: row.storage_path as string,
    sha256: row.sha256,
    byteLength: row.bytes,
  };
}

/** Persist a path-wide deletion fence BEFORE filesystem reads; no HTTP delivery. */
export async function reserveClaimedExportObjectCopy(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
  object: ClaimedExportObject,
): Promise<string | null> {
  if (
    !validIdentity(object.artifactId) ||
    typeof object.storagePath !== "string" ||
    object.storagePath.length === 0 ||
    object.storagePath.length > 1024 ||
    object.storagePath.trim() !== object.storagePath
  )
    return null;
  const token = randomUUID();
  const result = (await db.query(
    "select boardreadyops_begin_export_object_copy($1,$2,$3,$4,$5,$6,$7,$8::uuid) as outcome",
    [
      claim.exportId,
      claim.tenantId,
      claim.installationId,
      claim.workerId,
      claim.token,
      object.artifactId,
      object.storagePath,
      token,
    ],
  )) as { rows?: Array<{ outcome?: string }> };
  return result.rows?.[0]?.outcome === "reserved" ? token : null;
}

/** Call ONLY after physical read completion; uncertain settlement fails closed. */
export async function releaseClaimedExportObjectCopy(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
  token: string,
): Promise<void> {
  const result = (await db.query("select boardreadyops_finish_export_object_copy($1,$2,$3::uuid) as outcome", [
    claim.exportId,
    claim.workerId,
    token,
  ])) as { rows?: Array<{ outcome?: string }> };
  if (result.rows?.[0]?.outcome !== "released") {
    throw new Error("Export object copy reservation could not be settled");
  }
}
