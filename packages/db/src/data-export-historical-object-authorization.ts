import { randomUUID } from "node:crypto";
import {
  prepareVerifiedHistoricalUserCompositePreflight,
  prepareVerifiedHistoricalUserConsistentCorePreflight,
  prepareVerifiedHistoricalUserPrivateVisualEvidence,
} from "./data-export-historical-inventory.js";
import { isHistoricalUserUuid } from "./data-export-historical-uuid.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/** Original-user-gated private object reference; never an HTTP capability. */
export type HistoricalUserExportObject = {
  artifactId: string;
  repositoryId: string;
  runId: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
  retentionUntil: string;
};

export type HistoricalUserObjectReadAuthority = {
  exportId: string;
  verifiedGitHubUserId: number;
};

function validAuthority(value: unknown, artifactId: unknown): value is HistoricalUserObjectReadAuthority {
  if (value === null || typeof value !== "object") return false;
  const authority = value as Record<string, unknown>;
  return (
    isHistoricalUserUuid(authority.exportId) &&
    isHistoricalUserUuid(artifactId) &&
    typeof authority.verifiedGitHubUserId === "number" &&
    Number.isSafeInteger(authority.verifiedGitHubUserId) &&
    authority.verifiedGitHubUserId > 0
  );
}

function validOriginalUserObject(value: unknown): value is HistoricalUserExportObject {
  if (value === null || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return (
    isHistoricalUserUuid(object.artifactId) &&
    isHistoricalUserUuid(object.repositoryId) &&
    isHistoricalUserUuid(object.runId) &&
    typeof object.storagePath === "string" &&
    object.storagePath.length >= 1 &&
    object.storagePath.length <= 1024 &&
    object.storagePath.trim() === object.storagePath &&
    !object.storagePath.includes(String.fromCharCode(92)) &&
    !object.storagePath.includes("\0") &&
    !object.storagePath.includes(":") &&
    object.storagePath.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    typeof object.sha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(object.sha256) &&
    typeof object.byteLength === "number" &&
    Number.isSafeInteger(object.byteLength) &&
    object.byteLength >= 0 &&
    object.byteLength <= 64 * 1024 * 1024 &&
    typeof object.retentionUntil === "string" &&
    Number.isFinite(Date.parse(object.retentionUntil))
  );
}

function acknowledgedCopyOutcome(result: unknown, expected: "reserved" | "released"): boolean {
  if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return false;
  if (result.rows.length !== 1) return false;
  const row: unknown = result.rows[0];
  return row !== null && typeof row === "object" && "outcome" in row && row.outcome === expected;
}

/**
 * No contents or URL: only a bounded local object locator. Revalidate on both
 * sides of filesystem read; expired retention, suspended-owner mismatch,
 * completed erasure, status change, or a physical deletion queue fail closed.
 */
export async function lookupHistoricalUserExportObject(
  db: SqlQueryExecutor,
  authority: HistoricalUserObjectReadAuthority,
  artifactId: string,
): Promise<HistoricalUserExportObject | null> {
  if (!validAuthority(authority, artifactId)) return null;
  const result: unknown = await db.query(
    `SELECT a.id, a.run_id, repo.id AS repository_id, a.storage_path,
            a.sha256, a.bytes, a.retention_until
       FROM data_exports AS e
       JOIN installations AS i
         ON i.account_user_id=e.original_github_user_id
        AND lower(i.account_login)=lower(e.tenant_id)
        AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
       JOIN repositories AS repo ON repo.installation_id=i.id
       JOIN release_runs AS run ON run.repository_id=repo.id
       JOIN artifacts AS a ON a.run_id=run.id
      WHERE e.id=$1 AND e.original_github_user_id=$2
        AND e.scope='user' AND e.installation_id IS NULL
        AND lower(e.scope_id)=lower(e.tenant_id)
        AND e.requested_by='github_app_uninstall' AND e.status='pending'
        AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
        AND a.id=$3 AND a.retention_until IS NOT NULL
        AND a.retention_until>clock_timestamp()
        -- Do not return even a private storage locator while the immutable
        -- original USER source is expired, held or undergoing real erasure.
        -- A later publication gate still takes short locks to prevent races.
        AND NOT EXISTS (
          SELECT 1 FROM legal_holds AS hold
           WHERE lower(hold.tenant_id)=lower(e.tenant_id) AND hold.active=TRUE
        )
        AND NOT EXISTS (
          SELECT 1 FROM erasure_requests AS er
           WHERE lower(er.tenant_id)=lower(e.tenant_id)
             AND er.status IN ('running','completed') AND er.dry_run=FALSE
        )
        AND NOT EXISTS (
          SELECT 1 FROM artifact_deletion_jobs AS job
           WHERE job.storage_path=a.storage_path
        )
      LIMIT 1`,
    [authority.exportId, authority.verifiedGitHubUserId, artifactId],
  );
  // Disclose no locator unless the adapter returned exactly one valid row.
  const locatorRows = boundedPrepublicationRows(result);
  const row = locatorRows?.length === 1 ? locatorRows[0] : null;
  if (
    !row ||
    row.id !== artifactId ||
    !isHistoricalUserUuid(row.run_id) ||
    !isHistoricalUserUuid(row.repository_id) ||
    typeof row.storage_path !== "string" ||
    row.storage_path.length === 0 ||
    row.storage_path.length > 1024 ||
    row.storage_path.trim() !== row.storage_path ||
    typeof row.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.sha256) ||
    !Number.isSafeInteger(row.bytes) ||
    (row.bytes as number) < 0 ||
    (row.bytes as number) > 64 * 1024 * 1024 ||
    !(row.retention_until instanceof Date) ||
    !Number.isFinite(row.retention_until.getTime())
  ) {
    return null;
  }
  const object = {
    artifactId,
    repositoryId: row.repository_id,
    runId: row.run_id,
    storagePath: row.storage_path,
    sha256: row.sha256,
    byteLength: row.bytes,
    retentionUntil: row.retention_until.toISOString(),
  };
  // Even an authorized DB row must pass the SAME safe-path gate used
  // before physical reservation. Never disclose traversal locators.
  return validOriginalUserObject(object) ? object : null;
}

/** Durable cross-tenant path reservation before any physical IO. */
export async function reserveHistoricalUserObjectCopy(
  db: SqlQueryExecutor,
  authority: HistoricalUserObjectReadAuthority,
  object: HistoricalUserExportObject,
): Promise<{ readerId: string; token: string } | null> {
  if (!validAuthority(authority, object?.artifactId) || !validOriginalUserObject(object)) return null;
  const readerId = randomUUID();
  const token = randomUUID();
  const result: unknown = await db.query(
    `SELECT boardreadyops_begin_historical_user_artifact_copy(
       $1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid
     ) AS outcome`,
    [
      authority.exportId,
      authority.verifiedGitHubUserId,
      object.artifactId,
      object.storagePath,
      object.sha256,
      object.byteLength,
      readerId,
      token,
    ],
  );
  return acknowledgedCopyOutcome(result, "reserved") ? { readerId, token } : null;
}

/** Any uncertain settlement throws, quarantining the physical deletion path. */
export async function releaseHistoricalUserObjectCopy(
  db: SqlQueryExecutor,
  authority: HistoricalUserObjectReadAuthority,
  reservation: { readerId: string; token: string },
): Promise<void> {
  if (
    !isHistoricalUserUuid(authority?.exportId) ||
    !isHistoricalUserUuid(reservation?.readerId) ||
    !isHistoricalUserUuid(reservation?.token)
  ) {
    throw new Error("Historical user object reservation cannot be settled");
  }
  const result: unknown = await db.query("SELECT boardreadyops_finish_export_object_copy($1,$2,$3::uuid) AS outcome", [
    authority.exportId,
    `historical-user:${reservation.readerId}`,
    reservation.token,
  ]);
  if (!acknowledgedCopyOutcome(result, "released")) {
    throw new Error("Historical user object reservation cannot be settled");
  }
}

/**
 * Admit ALL artifact-copy reservations in one read-committed transaction,
 * before any physical IO. A stale/invalid object rolls back the entire set.
 * Sorted physical paths avoid lock-order inversion with another batch using
 * the same shared paths (possibly under a different tenant).
 *
 * These reservations block cooperative physical unlink workers, not changes
 * to export status, legal holds, or artifact retention. NOT publication.
 */
export async function reserveHistoricalUserObjectBatch(
  db: Pick<import("./pg-executor.js").PgQueryExecutor, "withTransaction">,
  authority: HistoricalUserObjectReadAuthority,
  objects: readonly HistoricalUserExportObject[],
): Promise<Array<{ object: HistoricalUserExportObject; reservation: { readerId: string; token: string } }> | null> {
  if (
    !db?.withTransaction ||
    !isHistoricalUserUuid(authority?.exportId) ||
    !Number.isSafeInteger(authority?.verifiedGitHubUserId) ||
    authority.verifiedGitHubUserId <= 0 ||
    !Array.isArray(objects) ||
    objects.length > 100 ||
    objects.some((object) => !validOriginalUserObject(object)) ||
    new Set(objects.map((object) => object.artifactId)).size !== objects.length
  )
    return null;

  // Keep the existing bytewise lock ordering: every worker must claim
  // artifacts in a stable order to avoid cross-worker deadlocks.
  const sorted = [...objects].sort((a, b) => {
    if (a.storagePath < b.storagePath) return -1;
    if (a.storagePath > b.storagePath) return 1;
    if (a.artifactId < b.artifactId) return -1;
    if (a.artifactId > b.artifactId) return 1;
    return 0;
  });
  class BatchAdmissionUnavailable extends Error {}
  try {
    return await db.withTransaction(
      async (tx) => {
        const admitted: Array<{
          object: HistoricalUserExportObject;
          reservation: { readerId: string; token: string };
        }> = [];
        for (const object of sorted) {
          const reservation = await reserveHistoricalUserObjectCopy(tx, authority, object);
          if (!reservation) throw new BatchAdmissionUnavailable();
          admitted.push({ object, reservation });
        }
        return admitted;
      },
      { statementTimeoutMs: 10_000 },
    );
  } catch (error) {
    if (error instanceof BatchAdmissionUnavailable) return null;
    throw error;
  }
}

/**
 * Best-effort settlement of EVERY held reservation, even if one fails.
 * An unresolved reservation is a deliberate path quarantine, not success.
 */
export async function releaseHistoricalUserObjectBatch(
  db: SqlQueryExecutor,
  authority: HistoricalUserObjectReadAuthority,
  admitted: readonly { reservation: { readerId: string; token: string } }[],
): Promise<void> {
  let failed = false;
  let firstFailure: unknown;
  for (const { reservation } of admitted) {
    try {
      await releaseHistoricalUserObjectCopy(db, authority, reservation);
    } catch (error) {
      if (!failed) firstFailure = error;
      failed = true;
    }
  }
  // Promise rejections may contain undefined/null/false/0. Never mistake a
  // falsy rejection for a fully settled batch: cleanup must stay quarantined.
  if (failed) {
    throw new Error("Historical user object batch reservations cannot be fully settled", { cause: firstFailure });
  }
}

/**
 * A SELECT ... LIMIT 1 must yield either zero or one object row. Missing,
 * malformed or multiple rows are ambiguous evidence, never "no hold".
 * Shared only by the source-only prepublication gate; NOT delivery auth.
 */
function boundedPrepublicationRows(result: unknown): readonly Record<string, unknown>[] | null {
  if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return null;
  if (
    result.rows.length > 1 ||
    !result.rows.every((row: unknown) => row !== null && typeof row === "object" && !Array.isArray(row))
  )
    return null;
  return result.rows as Record<string, unknown>[];
}

/**
 * Internal, point-in-time original-USER archive readiness gate.
 * Locks original export, all retained artifact rows and the legal-hold table
 * for this bounded transaction. Migration 0117 additionally fences relevant
 * new erasure/artifact writers with a tenant-specific advisory lock through
 * an optional fully awaited source-only write callback. Neither this nor the
 * per-write callback is a persisted delivery lease, publication, download
 * grant, or legal determination about an active hold.
 */
export async function checkHistoricalUserArchivePrepublication(input: {
  db: Pick<import("./pg-executor.js").PgQueryExecutor, "withTransaction">;
  authority: HistoricalUserObjectReadAuthority;
  objects: readonly HistoricalUserExportObject[];
  /**
   * Optional SOURCE-ONLY digest from the sealed PARTIAL core ZIP receipt.
   * Recomputed against the original numeric USER before and after a bounded
   * transfer callback. NOT a complete archive, delivery lease or grant.
   */
  expectedCore?: { sha256: string; byteLength: number };
  /** Separately SHA-verified, content-free visual manifest from the same private PARTIAL ZIP. */
  expectedVisual?: { sha256: string; byteLength: number; visualCount: number };
  /** Transactional original-user mutation stamp; detects covered committed edit-restore ABA. */
  expectedMutationEpochSha256?: string;
  /**
   * SOURCE-ONLY transport test hook. A strictly bounded write may be awaited
   * while this transaction still owns the hold/export/installation locks.
   * Never use this as permission to expose a partial historical ZIP via HTTP.
   */
  underLock?: () => Promise<void>;
}): Promise<"eligible" | "held" | "stale" | "busy"> {
  const { db, authority, objects } = input ?? {};
  if (
    !db?.withTransaction ||
    (input?.expectedMutationEpochSha256 !== undefined &&
      (typeof input.expectedMutationEpochSha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(input.expectedMutationEpochSha256) ||
        !input.expectedCore ||
        !input.expectedVisual)) ||
    (input?.expectedCore !== undefined &&
      (!input.expectedCore ||
        typeof input.expectedCore.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(input.expectedCore.sha256) ||
        !Number.isSafeInteger(input.expectedCore.byteLength) ||
        input.expectedCore.byteLength < 1 ||
        input.expectedCore.byteLength > 256 * 1024)) ||
    (input?.expectedVisual !== undefined &&
      (!input.expectedVisual ||
        typeof input.expectedVisual.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(input.expectedVisual.sha256) ||
        !Number.isSafeInteger(input.expectedVisual.byteLength) ||
        input.expectedVisual.byteLength < 1 ||
        input.expectedVisual.byteLength > 256 * 1024 ||
        !Number.isSafeInteger(input.expectedVisual.visualCount) ||
        input.expectedVisual.visualCount < 0 ||
        input.expectedVisual.visualCount > 100)) ||
    !isHistoricalUserUuid(authority?.exportId) ||
    !Number.isSafeInteger(authority?.verifiedGitHubUserId) ||
    authority.verifiedGitHubUserId <= 0 ||
    !Array.isArray(objects) ||
    objects.length > 100 ||
    objects.some((object) => !validOriginalUserObject(object)) ||
    new Set(objects.map((object) => object.artifactId)).size !== objects.length
  )
    return "stale";

  try {
    return await db.withTransaction(
      async (tx) => {
        // Prevent concurrent hold writes only during this bounded check.
        await tx.query("LOCK TABLE public.legal_holds IN SHARE MODE NOWAIT");
        const sourceResult: unknown = await tx.query(
          `SELECT e.tenant_id
             FROM public.data_exports AS e
             JOIN public.installations AS i
               ON i.account_user_id=e.original_github_user_id
              AND lower(i.account_login)=lower(e.tenant_id)
              AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
            WHERE e.id=$1 AND e.original_github_user_id=$2::bigint
              AND e.scope='user' AND e.installation_id IS NULL
              AND e.requested_by='github_app_uninstall' AND e.status='pending'
              AND lower(e.scope_id)=lower(e.tenant_id)
              AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
            FOR SHARE OF e,i NOWAIT`,
          [authority.exportId, authority.verifiedGitHubUserId],
        );
        const sourceRows = boundedPrepublicationRows(sourceResult);
        if (sourceRows?.length !== 1) return "stale";
        const tenant = sourceRows[0]?.tenant_id;
        if (typeof tenant !== "string" || !tenant) return "stale";

        // Migration 0117 makes erasure writers and new artifact inserts
        // acquire this tenant key before their changes commit. Take the key
        // BEFORE querying for both erasure and the complete object manifest.
        const advisoryRows = boundedPrepublicationRows(
          await tx.query("SELECT pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1))", [
            tenant,
          ]),
        );
        if (advisoryRows?.length !== 1) return "stale";
        const holdsResult: unknown = await tx.query(
          `SELECT 1 FROM public.legal_holds
            WHERE lower(tenant_id)=lower($1) AND active=TRUE LIMIT 1`,
          [tenant],
        );
        const holdRows = boundedPrepublicationRows(holdsResult);
        if (holdRows === null) return "stale";
        // A hold is an internal review requirement, not an export prohibition.
        if (holdRows.length === 1) return "held";

        const erasureResult: unknown = await tx.query(
          `SELECT 1 FROM public.erasure_requests er
            WHERE lower(er.tenant_id)=lower($1)
              AND er.dry_run=FALSE AND er.status IN ('running','completed')
              AND (
                er.scope='organization' OR
                (er.scope='user' AND lower(er.scope_id)=lower($1)) OR
                (er.scope='repository' AND er.scope_id=ANY($2::text[]))
              )
            LIMIT 1`,
          [tenant, [...new Set(objects.map((obj) => obj.repositoryId))]],
        );
        const erasureRows = boundedPrepublicationRows(erasureResult);
        if (erasureRows === null || erasureRows.length !== 0) return "stale";

        // Enumerate ALL current retained objects, even expired ones, to avoid
        // accidentally accepting a truncated subset of the original account.
        const result = (await tx.query(
          `SELECT a.id AS artifact_id, run.id AS run_id, repo.id AS repository_id,
                  a.storage_path, a.sha256, a.bytes, a.retention_until,
                  (a.retention_until IS NOT NULL AND
                   a.retention_until>clock_timestamp()+interval '1 minute') AS retention_safe,
                  EXISTS (
                    SELECT 1 FROM public.artifact_deletion_jobs job
                     WHERE job.storage_path=a.storage_path
                  ) AS queued_for_deletion,
                  EXISTS (
                    SELECT 1 FROM public.artifact_unlink_fences AS f
                    JOIN public.artifact_deletion_jobs AS job ON job.id=f.deletion_job_id
                     WHERE f.settled_at IS NULL AND job.storage_path=a.storage_path
                  ) AS unlink_in_progress
             FROM public.artifacts AS a
             JOIN public.release_runs AS run ON run.id=a.run_id
             JOIN public.repositories AS repo ON repo.id=run.repository_id
             JOIN public.installations AS i ON i.id=repo.installation_id
            WHERE i.account_user_id=$1::bigint AND lower(i.account_login)=lower($2)
              AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
            ORDER BY a.id LIMIT 101
            FOR SHARE OF a,run,repo,i NOWAIT`,
          [authority.verifiedGitHubUserId, tenant],
        )) as { rows?: Array<Record<string, unknown>> };
        const rows = result.rows;
        if (!Array.isArray(rows) || rows.length !== objects.length) return "stale";
        const expected = new Map(objects.map((obj) => [obj.artifactId, obj]));
        const seen = new Set<string>();
        for (const row of rows) {
          // Duplicate rows could conceal a missing expected object despite
          // an otherwise matching row count.
          if (!row || typeof row !== "object" || typeof row.artifact_id !== "string" || seen.has(row.artifact_id))
            return "stale";
          seen.add(row.artifact_id);
          const obj = expected.get(row.artifact_id);
          if (
            !obj ||
            row.run_id !== obj.runId ||
            row.repository_id !== obj.repositoryId ||
            row.storage_path !== obj.storagePath ||
            row.sha256 !== obj.sha256 ||
            row.bytes !== obj.byteLength ||
            !(row.retention_until instanceof Date) ||
            row.retention_until.toISOString() !== obj.retentionUntil ||
            row.retention_safe !== true ||
            row.queued_for_deletion !== false ||
            row.unlink_in_progress !== false
          )
            return "stale";
        }
        if (seen.size !== expected.size) return "stale";
        // Compare the original-user scoped, repeatable-read audit/review
        // core digest against a previously sealed PRIVATE partial ZIP core.
        // This read uses a distinct read-only PG client; advisory writer
        // fences cover original-user audit/review inserts until commit.
        // Other review-content edits can still race, hence recheck after IO.
        const coreMatches = async (): Promise<boolean> => {
          if (!input.expectedCore) return true;
          const core = await prepareVerifiedHistoricalUserConsistentCorePreflight(db, authority);
          return (
            core !== null &&
            core.sha256 === input.expectedCore.sha256 &&
            core.byteLength === input.expectedCore.byteLength
          );
        };
        const visualMatches = async (): Promise<boolean> => {
          if (!input.expectedVisual) return true;
          const evidence = await prepareVerifiedHistoricalUserPrivateVisualEvidence(db, authority);
          return (
            evidence !== null &&
            evidence.sha256 === input.expectedVisual.sha256 &&
            evidence.byteLength === input.expectedVisual.byteLength &&
            evidence.visualCount === input.expectedVisual.visualCount
          );
        };
        const allMatches = async (): Promise<boolean> => {
          if (input.expectedCore && input.expectedVisual) {
            const pair = await prepareVerifiedHistoricalUserCompositePreflight(db, authority);
            return (
              pair !== null &&
              pair.core.sha256 === input.expectedCore.sha256 &&
              pair.core.byteLength === input.expectedCore.byteLength &&
              pair.visual.sha256 === input.expectedVisual.sha256 &&
              pair.visual.byteLength === input.expectedVisual.byteLength &&
              pair.visual.visualCount === input.expectedVisual.visualCount &&
              (input.expectedMutationEpochSha256 === undefined ||
                pair.mutationEpochSha256 === input.expectedMutationEpochSha256)
            );
          }
          return (await coreMatches()) && (await visualMatches());
        };
        if (!(await allMatches())) return "stale";
        // The caller cannot send a byte before the entire manifest is checked.
        // Row and hold locks survive this awaited operation until COMMIT.
        if (input.underLock) await input.underLock();
        // A metadata edit committed during the callback can make the already
        // handed-off bytes unverifiable. Fail closed rather than report success;
        // OS-accepted bytes cannot be recalled, so this is NOT delivery auth.
        if (!(await allMatches())) return "stale";
        return "eligible";
      },
      { statementTimeoutMs: 10_000 },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "55P03" || error.code === "57014"))
      return "busy";
    throw error;
  }
}
