import { randomUUID } from "node:crypto";
import { prepareVerifiedHistoricalUserCompositePreflight } from "./data-export-historical-inventory.js";
import { isHistoricalUserUuid } from "./data-export-historical-uuid.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * SOURCE-ONLY, internal audit/revocation rehearsal for a PARTIAL historical
 * archive. A preflight row is NOT a bearer token, publication authorization,
 * download lease, URL or evidence of a complete customer export.
 */
type HistoricalUserAuthority = { exportId: string; verifiedGitHubUserId: number };
type PrivateArchiveFingerprint = {
  archiveSha256: string;
  archiveByteLength: number;
  coreSha256: string;
  visualSha256: string;
  mutationEpochSha256: string;
};
type PreflightDb = Pick<PgQueryExecutor, "withTransaction">;

const digest = /^[0-9a-f]{64}$/u;
function validAuthority(a: HistoricalUserAuthority): boolean {
  return (
    isHistoricalUserUuid(a?.exportId) && Number.isSafeInteger(a?.verifiedGitHubUserId) && a.verifiedGitHubUserId > 0
  );
}
function validFingerprint(f: PrivateArchiveFingerprint): boolean {
  return (
    !!f &&
    digest.test(f.archiveSha256) &&
    digest.test(f.coreSha256) &&
    digest.test(f.visualSha256) &&
    digest.test(f.mutationEpochSha256) &&
    Number.isSafeInteger(f.archiveByteLength) &&
    f.archiveByteLength > 0 &&
    f.archiveByteLength <= 64 * 1024 * 1024
  );
}
// These digests must describe the CURRENT original numeric USER snapshot.
// The archive-byte SHA is still a private candidate value, not attested
// customer-export content and never a bearer/download capability.
async function currentOriginalUserSnapshotMatches(
  db: PreflightDb,
  authority: HistoricalUserAuthority,
  fingerprint: PrivateArchiveFingerprint,
): Promise<boolean> {
  const pair = await prepareVerifiedHistoricalUserCompositePreflight(db, authority);
  return (
    pair !== null &&
    pair.core.sha256 === fingerprint.coreSha256 &&
    pair.visual.sha256 === fingerprint.visualSha256 &&
    pair.mutationEpochSha256 === fingerprint.mutationEpochSha256
  );
}

type Admission = { tenant_id: string };

function exactPreflightAdmissionRow(result: unknown): Record<string, unknown> | null {
  if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return null;
  if (result.rows.length !== 1) return null;
  const row: unknown = result.rows[0];
  return row !== null && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
}

async function authorizeSuspendedOriginalUser(
  tx: SqlQueryExecutor,
  authority: HistoricalUserAuthority,
): Promise<Admission | null> {
  // Keep the legal-hold DDL / writer lock only for a bounded DB transaction,
  // NEVER through an HTTP send or customer-facing stream.
  await tx.query("LOCK TABLE public.legal_holds IN SHARE MODE NOWAIT");
  const result: unknown = await tx.query(
    `SELECT e.tenant_id
       FROM public.data_exports e
       JOIN public.installations i
         ON i.account_user_id=e.original_github_user_id
        AND lower(i.account_login)=lower(e.tenant_id)
        AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
      WHERE e.id=$1 AND e.original_github_user_id=$2::bigint
        AND e.scope='user' AND e.installation_id IS NULL
        AND e.requested_by='github_app_uninstall'
        AND e.status='pending'
        AND lower(e.scope_id)=lower(e.tenant_id)
        AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
      FOR SHARE OF e,i NOWAIT`,
    [authority.exportId, authority.verifiedGitHubUserId],
  );
  const tenant = exactPreflightAdmissionRow(result)?.tenant_id;
  if (typeof tenant !== "string" || tenant.length < 1) return null;
  await tx.query("SELECT pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1))", [tenant]);
  const blocks: unknown = await tx.query(
    `SELECT EXISTS (
        SELECT 1 FROM public.legal_holds h
         WHERE lower(h.tenant_id)=lower($1) AND h.active=TRUE
       ) AS active_hold,
       EXISTS (
        SELECT 1 FROM public.erasure_requests er
         WHERE lower(er.tenant_id)=lower($1) AND er.dry_run=FALSE
           AND er.status IN ('running','completed')
       ) AS active_erasure`,
    [tenant],
  );
  const blockers = exactPreflightAdmissionRow(blocks);
  if (blockers?.active_hold !== false || blockers.active_erasure !== false) return null;
  return { tenant_id: tenant };
}

/**
 * INTERNAL trusted DB primitive. The archive SHA is a caller-provided
 * candidate until the web private preflight verifies ACTUAL ZIP bytes and
 * derives every fingerprint from the ZIP. Never wire this directly to a
 * public body or download capability.
 */

export async function stageHistoricalUserPrivateDeliveryPreflight(input: {
  db: PreflightDb;
  authority: HistoricalUserAuthority;
  fingerprint: PrivateArchiveFingerprint;
  ttlSeconds: number;
}): Promise<{ id: string } | null> {
  if (
    !input?.db?.withTransaction ||
    !validAuthority(input.authority) ||
    !validFingerprint(input.fingerprint) ||
    !Number.isSafeInteger(input.ttlSeconds) ||
    input.ttlSeconds < 1 ||
    input.ttlSeconds > 600
  )
    return null;
  const id = randomUUID();
  const f = input.fingerprint;
  if (!(await currentOriginalUserSnapshotMatches(input.db, input.authority, f))) return null;
  try {
    return await input.db.withTransaction(
      async (tx) => {
        if (!(await authorizeSuspendedOriginalUser(tx, input.authority))) return null;
        const result: unknown = await tx.query(
          `INSERT INTO public.historical_user_private_delivery_preflights (
            id,export_id,original_github_user_id,
            expected_archive_sha256,expected_archive_bytes,
            expected_core_sha256,expected_visual_sha256,
            expected_mutation_epoch_sha256,created_at,expires_at
          )
          SELECT $1::uuid,$2,$3::bigint,$4,$5::bigint,$6,$7,$8,
                 tick.t, tick.t + ($9::integer * INTERVAL '1 second')
            FROM (SELECT clock_timestamp() AS t) AS tick
          ON CONFLICT (export_id) DO NOTHING
          RETURNING id::text AS id`,
          [
            id,
            input.authority.exportId,
            input.authority.verifiedGitHubUserId,
            f.archiveSha256,
            f.archiveByteLength,
            f.coreSha256,
            f.visualSha256,
            f.mutationEpochSha256,
            input.ttlSeconds,
          ],
        );
        if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
          throw new Error("Historical private preflight insertion was not acknowledged");
        }
        // ON CONFLICT DO NOTHING legitimately returns zero rows.
        if (result.rows.length === 0) return null;
        // Any other ambiguous reply must abort the transaction instead of
        // committing a preflight with an unverified result.
        if (result.rows.length !== 1) {
          throw new Error("Historical private preflight insertion was not acknowledged");
        }
        const row: unknown = result.rows[0];
        if (row === null || typeof row !== "object" || !("id" in row) || row.id !== id) {
          throw new Error("Historical private preflight insertion was not acknowledged");
        }
        return { id };
      },
      { statementTimeoutMs: 5_000 },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      ["55P03", "57014"].includes(String((error as { code?: string }).code))
    )
      return null;
    throw error;
  }
}

/** Read internal state only. "current" NEVER means a customer may download. */
export async function inspectHistoricalUserPrivateDeliveryPreflight(input: {
  db: PreflightDb;
  authority: HistoricalUserAuthority;
  id: string;
  fingerprint: PrivateArchiveFingerprint;
}): Promise<"current" | "stale"> {
  if (
    !input?.db?.withTransaction ||
    !validAuthority(input.authority) ||
    !isHistoricalUserUuid(input.id) ||
    !validFingerprint(input.fingerprint)
  )
    return "stale";
  const f = input.fingerprint;
  if (!(await currentOriginalUserSnapshotMatches(input.db, input.authority, f))) return "stale";
  try {
    return await input.db.withTransaction(
      async (tx) => {
        if (!(await authorizeSuspendedOriginalUser(tx, input.authority))) return "stale";
        const result = (await tx.query(
          `SELECT 1 FROM public.historical_user_private_delivery_preflights p
          WHERE p.id=$1::uuid AND p.export_id=$2 AND p.original_github_user_id=$3::bigint
            AND p.expected_archive_sha256=$4 AND p.expected_archive_bytes=$5::bigint
            AND p.expected_core_sha256=$6 AND p.expected_visual_sha256=$7
            AND p.expected_mutation_epoch_sha256=$8
            AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp()
            AND p.complete_customer_export=FALSE
            AND p.customer_delivery_allowed=FALSE
            AND p.purpose='private-source-only-preflight'
          FOR SHARE OF p NOWAIT`,
          [
            input.id,
            input.authority.exportId,
            input.authority.verifiedGitHubUserId,
            f.archiveSha256,
            f.archiveByteLength,
            f.coreSha256,
            f.visualSha256,
            f.mutationEpochSha256,
          ],
        )) as { rows?: unknown[] };
        return result.rows?.length === 1 ? "current" : "stale";
      },
      { statementTimeoutMs: 5_000 },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      ["55P03", "57014"].includes(String((error as { code?: string }).code))
    )
      return "stale";
    throw error;
  }
}

/** One-way durable revocation, not a publish/unpublish transition. */
export async function revokeHistoricalUserPrivateDeliveryPreflight(input: {
  db: Pick<SqlQueryExecutor, "query">;
  authority: HistoricalUserAuthority;
  id: string;
}): Promise<"revoked" | "stale"> {
  if (!input?.db?.query || !validAuthority(input.authority) || !isHistoricalUserUuid(input.id)) return "stale";
  const result: unknown = await input.db.query(
    `UPDATE public.historical_user_private_delivery_preflights AS p
          SET revoked_at=clock_timestamp()
         FROM public.data_exports AS e
        WHERE p.id=$1::uuid AND p.export_id=$2
          AND p.original_github_user_id=$3::bigint AND p.revoked_at IS NULL
          AND e.id=p.export_id AND e.original_github_user_id=$3::bigint
          AND e.scope='user' AND e.requested_by='github_app_uninstall'
       RETURNING p.id`,
    [input.id, input.authority.exportId, input.authority.verifiedGitHubUserId],
  );
  if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows))
    return "stale";
  if (result.rows.length !== 1) return "stale";
  const row: unknown = result.rows[0];
  // Only the exact original USER preflight may acknowledge this revocation.
  return row !== null && typeof row === "object" && "id" in row && row.id === input.id ? "revoked" : "stale";
}
