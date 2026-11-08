import { randomUUID } from "node:crypto";
import { isValidExportSha256 } from "./data-export-hex-digest.js";
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

/** Never accept path traversal, alternate data streams or ambiguous physical segments. */
function validOriginalUserStoragePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1024 ||
    value.trim() !== value ||
    value.includes(String.fromCodePoint(92)) ||
    value.includes("\0") ||
    value.includes(":")
  )
    return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validOriginalUserArtifactSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 64 * 1024 * 1024;
}

function validOriginalUserRetention(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validOriginalUserObject(value: unknown): value is HistoricalUserExportObject {
  if (value === null || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return (
    isHistoricalUserUuid(object.artifactId) &&
    isHistoricalUserUuid(object.repositoryId) &&
    isHistoricalUserUuid(object.runId) &&
    validOriginalUserStoragePath(object.storagePath) &&
    isValidExportSha256(object.sha256) &&
    validOriginalUserArtifactSize(object.byteLength) &&
    validOriginalUserRetention(object.retentionUntil)
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
    row?.id !== artifactId ||
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
  // Capture untrusted mutable object fields synchronously. The caller may
  // change its original array or objects while we await DB locks.
  const stableObjects = Array.isArray(objects) ? objects.map((item) => ({ ...item })) : null;
  const stableAuthority = authority && typeof authority === "object" ? { ...authority } : null;
  if (
    !db?.withTransaction ||
    !isHistoricalUserUuid(stableAuthority?.exportId) ||
    !Number.isSafeInteger(stableAuthority?.verifiedGitHubUserId) ||
    stableAuthority.verifiedGitHubUserId <= 0 ||
    !stableObjects ||
    stableObjects.length > 100 ||
    stableObjects.some((object) => !validOriginalUserObject(object)) ||
    new Set(stableObjects.map((object) => object.artifactId)).size !== stableObjects.length
  )
    return null;

  // Keep the existing bytewise lock ordering: every worker must claim
  // artifacts in a stable order to avoid cross-worker deadlocks.
  const sorted = stableObjects.toSorted((a, b) => {
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
          const reservation = await reserveHistoricalUserObjectCopy(tx, stableAuthority, object);
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

type ExpectedPrepublicationEvidence = {
  expectedCore?: { sha256: string; byteLength: number };
  expectedVisual?: { sha256: string; byteLength: number; visualCount: number };
  expectedMutationEpochSha256?: string;
};

function validExpectedPrepublicationCore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const core = value as Record<string, unknown>;
  return (
    typeof core.sha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(core.sha256) &&
    typeof core.byteLength === "number" &&
    Number.isSafeInteger(core.byteLength) &&
    core.byteLength >= 1 &&
    core.byteLength <= 256 * 1024
  );
}

function validExpectedPrepublicationVisual(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const visual = value as Record<string, unknown>;
  return (
    typeof visual.sha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(visual.sha256) &&
    typeof visual.byteLength === "number" &&
    Number.isSafeInteger(visual.byteLength) &&
    visual.byteLength >= 1 &&
    visual.byteLength <= 256 * 1024 &&
    typeof visual.visualCount === "number" &&
    Number.isSafeInteger(visual.visualCount) &&
    visual.visualCount >= 0 &&
    visual.visualCount <= 100
  );
}

function validExpectedPrepublicationEvidence(input: ExpectedPrepublicationEvidence): boolean {
  if (input.expectedCore !== undefined && !validExpectedPrepublicationCore(input.expectedCore)) return false;
  if (input.expectedVisual !== undefined && !validExpectedPrepublicationVisual(input.expectedVisual)) return false;
  if (input.expectedMutationEpochSha256 === undefined) return true;
  return (
    typeof input.expectedMutationEpochSha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(input.expectedMutationEpochSha256) &&
    input.expectedCore !== undefined &&
    input.expectedVisual !== undefined
  );
}

function validPrepublicationSource(
  db: Pick<import("./pg-executor.js").PgQueryExecutor, "withTransaction">,
  authority: HistoricalUserObjectReadAuthority | null,
  objects: readonly HistoricalUserExportObject[] | null,
): boolean {
  return (
    !!db?.withTransaction &&
    isHistoricalUserUuid(authority?.exportId) &&
    Number.isSafeInteger(authority?.verifiedGitHubUserId) &&
    (authority?.verifiedGitHubUserId ?? 0) > 0 &&
    objects !== null &&
    objects.length <= 100 &&
    objects.every((item) => validOriginalUserObject(item)) &&
    new Set(objects.map((item) => item.artifactId)).size === objects.length
  );
}

function matchesPrepublicationArtifactRow(row: Record<string, unknown>, expected: HistoricalUserExportObject): boolean {
  return (
    row.run_id === expected.runId &&
    row.repository_id === expected.repositoryId &&
    row.storage_path === expected.storagePath &&
    row.sha256 === expected.sha256 &&
    row.bytes === expected.byteLength &&
    row.retention_until instanceof Date &&
    row.retention_until.toISOString() === expected.retentionUntil &&
    row.retention_safe === true &&
    row.queued_for_deletion === false &&
    row.unlink_in_progress === false
  );
}

function matchesCompletePrepublicationManifest(rows: unknown, objects: readonly HistoricalUserExportObject[]): boolean {
  if (!Array.isArray(rows) || rows.length !== objects.length) return false;
  const expected = new Map(objects.map((item) => [item.artifactId, item]));
  const seen = new Set<string>();
  for (const item of rows) {
    if (item === null || typeof item !== "object" || typeof item.artifact_id !== "string") return false;
    if (seen.has(item.artifact_id)) return false;
    const object = expected.get(item.artifact_id);
    if (!object || !matchesPrepublicationArtifactRow(item, object)) return false;
    seen.add(item.artifact_id);
  }
  return seen.size === expected.size;
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
  // Pin ALL evidence and the bounded physical transfer callback before the
  // first DB await. A mutable caller's expected SHA or transfer function
  // cannot be replaced between snapshot checks to manufacture "eligible".
  const stableExpectedCore = input?.expectedCore && { ...input.expectedCore };
  const stableExpectedVisual = input?.expectedVisual && { ...input.expectedVisual };
  const stableExpectedMutationEpochSha256 = input?.expectedMutationEpochSha256;
  const underLock = input?.underLock;
  const stableEvidence: ExpectedPrepublicationEvidence = {
    ...(stableExpectedCore !== undefined ? { expectedCore: stableExpectedCore } : {}),
    ...(stableExpectedVisual !== undefined ? { expectedVisual: stableExpectedVisual } : {}),
    ...(stableExpectedMutationEpochSha256 !== undefined
      ? { expectedMutationEpochSha256: stableExpectedMutationEpochSha256 }
      : {}),
  };
  // Snapshot each physical object's scalar properties BEFORE any transaction
  // await. An incoming readonly array is not proof its members are immutable.
  const stableObjects = Array.isArray(objects) ? objects.map((item) => ({ ...item })) : null;
  const stableAuthority = authority && typeof authority === "object" ? { ...authority } : null;
  if (
    stableAuthority === null ||
    stableObjects === null ||
    !validExpectedPrepublicationEvidence(stableEvidence) ||
    !validPrepublicationSource(db, stableAuthority, stableObjects)
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
          [stableAuthority.exportId, stableAuthority.verifiedGitHubUserId],
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
          [tenant, [...new Set(stableObjects.map((obj) => obj.repositoryId))]],
        );
        const erasureRows = boundedPrepublicationRows(erasureResult);
        if (erasureRows?.length !== 0) return "stale";

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
          [stableAuthority.verifiedGitHubUserId, tenant],
        )) as { rows?: Array<Record<string, unknown>> };
        if (!matchesCompletePrepublicationManifest(result.rows, stableObjects)) return "stale";
        // Compare the original-user scoped, repeatable-read audit/review
        // core digest against a previously sealed PRIVATE partial ZIP core.
        // This read uses a distinct read-only PG client; advisory writer
        // fences cover original-user audit/review inserts until commit.
        // Other review-content edits can still race, hence recheck after IO.
        const coreMatches = async (): Promise<boolean> => {
          if (!stableExpectedCore) return true;
          const core = await prepareVerifiedHistoricalUserConsistentCorePreflight(db, stableAuthority);
          return (
            core !== null &&
            core.sha256 === stableExpectedCore.sha256 &&
            core.byteLength === stableExpectedCore.byteLength
          );
        };
        const visualMatches = async (): Promise<boolean> => {
          if (!stableExpectedVisual) return true;
          const evidence = await prepareVerifiedHistoricalUserPrivateVisualEvidence(db, stableAuthority);
          return (
            evidence !== null &&
            evidence.sha256 === stableExpectedVisual.sha256 &&
            evidence.byteLength === stableExpectedVisual.byteLength &&
            evidence.visualCount === stableExpectedVisual.visualCount
          );
        };
        const allMatches = async (): Promise<boolean> => {
          if (stableExpectedCore && stableExpectedVisual) {
            const pair = await prepareVerifiedHistoricalUserCompositePreflight(db, stableAuthority);
            return (
              pair !== null &&
              pair.core.sha256 === stableExpectedCore.sha256 &&
              pair.core.byteLength === stableExpectedCore.byteLength &&
              pair.visual.sha256 === stableExpectedVisual.sha256 &&
              pair.visual.byteLength === stableExpectedVisual.byteLength &&
              pair.visual.visualCount === stableExpectedVisual.visualCount &&
              (stableExpectedMutationEpochSha256 === undefined ||
                pair.mutationEpochSha256 === stableExpectedMutationEpochSha256)
            );
          }
          return (await coreMatches()) && (await visualMatches());
        };
        if (!(await allMatches())) return "stale";
        // The caller cannot send a byte before the entire manifest is checked.
        // Row and hold locks survive this awaited operation until COMMIT.
        if (underLock) await underLock();
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
