import { randomUUID } from "node:crypto";
import type { PgQueryExecutor } from "./pg-executor.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const digest = /^[0-9a-f]{64}$/u;

type ReaderDb = Pick<PgQueryExecutor, "withTransaction">;
type PrivatePartialBinding = {
  exportId: string;
  verifiedGitHubUserId: number;
  preflightId: string;
  sha256: string;
  byteLength: number;
};
type PrivatePartialReservation = { token: string };

function valid(input: unknown): input is PrivatePartialBinding {
  if (input === null || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate.exportId === "string" &&
    uuid.test(candidate.exportId) &&
    typeof candidate.verifiedGitHubUserId === "number" &&
    Number.isSafeInteger(candidate.verifiedGitHubUserId) &&
    candidate.verifiedGitHubUserId > 0 &&
    typeof candidate.preflightId === "string" &&
    uuid.test(candidate.preflightId) &&
    typeof candidate.sha256 === "string" &&
    digest.test(candidate.sha256) &&
    typeof candidate.byteLength === "number" &&
    Number.isSafeInteger(candidate.byteLength) &&
    candidate.byteLength >= 1 &&
    candidate.byteLength <= 64 * 1024 * 1024
  );
}

function validReservation(input: unknown): input is PrivatePartialBinding & PrivatePartialReservation {
  if (!valid(input)) return false;
  const candidate = input as unknown as Record<string, unknown>;
  return typeof candidate.token === "string" && uuid.test(candidate.token);
}

function hasTransaction(db: unknown): db is ReaderDb {
  return db !== null && typeof db === "object" && "withTransaction" in db && typeof db.withTransaction === "function";
}

function hasQuery(db: unknown): db is Pick<PgQueryExecutor, "query"> {
  return db !== null && typeof db === "object" && "query" in db && typeof db.query === "function";
}

function rows(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  return Array.isArray(result.rows) ? (result.rows as Record<string, unknown>[]) : [];
}

/**
 * SOURCE-ONLY durable internal verification reservation (NEVER a download
 * token). Registration must commit BEFORE physical read. A release is
 * explicit and irreversible; abandoned reservations NEVER auto-expire.
 * The exact original numeric USER, still-pending export, immutable active
 * preflight and archive digest are all verified under the same locks used
 * by cleanup. No external network or filesystem IO inside the transaction.
 */
export async function reserveHistoricalUserPrivatePartialRead(
  db: ReaderDb,
  binding: PrivatePartialBinding,
): Promise<PrivatePartialReservation | null> {
  if (!hasTransaction(db) || !valid(binding)) return null;
  const token = randomUUID();
  try {
    return await db.withTransaction(
      async (tx) => {
        await tx.query("LOCK TABLE public.legal_holds IN SHARE MODE NOWAIT");
        const owner = rows(
          await tx.query(
            `SELECT e.tenant_id
           FROM public.data_exports e
           JOIN public.installations i
             ON i.account_user_id=e.original_github_user_id
            AND lower(i.account_login)=lower(e.tenant_id)
            AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
           JOIN public.historical_user_private_delivery_preflights p
             ON p.export_id=e.id
            AND p.original_github_user_id=e.original_github_user_id
          WHERE e.id=$1 AND e.original_github_user_id=$2::bigint
            AND e.scope='user' AND e.installation_id IS NULL
            AND e.requested_by='github_app_uninstall'
            AND lower(e.scope_id)=lower(e.tenant_id)
            AND e.status='pending'
            AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
            AND p.id=$3::uuid
            AND p.expected_archive_sha256=$4
            AND p.expected_archive_bytes=$5::bigint
            AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp()
            AND p.customer_delivery_allowed=FALSE AND p.complete_customer_export=FALSE
            AND NOT EXISTS (
              SELECT 1 FROM public.historical_user_partial_cleanup_events cleaned
               WHERE cleaned.export_id=e.id
            )
          FOR SHARE OF e,i,p NOWAIT`,
            [binding.exportId, binding.verifiedGitHubUserId, binding.preflightId, binding.sha256, binding.byteLength],
          ),
        );
        const tenant = owner[0]?.tenant_id;
        if (typeof tenant !== "string" || tenant.length < 1) return null;
        const locked = rows(
          await tx.query(
            "SELECT pg_try_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1)) AS acquired",
            [tenant],
          ),
        );
        if (locked[0]?.acquired !== true) return null;
        const blockers = rows(
          await tx.query(
            `SELECT
          EXISTS(SELECT 1 FROM public.legal_holds h
             WHERE lower(h.tenant_id)=lower($1) AND h.active=TRUE) AS held,
          EXISTS(SELECT 1 FROM public.erasure_requests er
             WHERE lower(er.tenant_id)=lower($1) AND er.dry_run=FALSE
               AND er.status IN ('running','completed')) AS erasure`,
            [tenant],
          ),
        );
        if (blockers[0]?.held !== false || blockers[0]?.erasure !== false) return null;

        const created = rows(
          await tx.query(
            `INSERT INTO public.historical_user_partial_read_reservations(
          token,export_id,preflight_id,original_github_user_id,
          archive_sha256,archive_byte_length
        ) VALUES($1::uuid,$2,$3::uuid,$4::bigint,$5,$6::bigint)
        RETURNING token::text AS token`,
            [
              token,
              binding.exportId,
              binding.preflightId,
              binding.verifiedGitHubUserId,
              binding.sha256,
              binding.byteLength,
            ],
          ),
        );
        return created[0]?.token === token ? { token } : null;
      },
      { statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}

/** Explicitly settle ONE reservation after all local disk IO has ended.
 * A DB outage must leave the reservation unresolved rather than let
 * cleanup assume a reader is gone; no force-release or TTL is available.
 */
export async function releaseHistoricalUserPrivatePartialRead(
  db: Pick<PgQueryExecutor, "query">,
  input: PrivatePartialBinding & PrivatePartialReservation,
): Promise<boolean> {
  if (!hasQuery(db) || !validReservation(input)) return false;
  try {
    const released = rows(
      await db.query(
        `UPDATE public.historical_user_partial_read_reservations r
          SET released_at=clock_timestamp()
        WHERE r.token=$1::uuid AND r.export_id=$2 AND r.preflight_id=$3::uuid
          AND r.original_github_user_id=$4::bigint
          AND r.archive_sha256=$5 AND r.archive_byte_length=$6::bigint
          AND r.released_at IS NULL
        RETURNING r.token::text AS token`,
        [input.token, input.exportId, input.preflightId, input.verifiedGitHubUserId, input.sha256, input.byteLength],
      ),
    );
    return released[0]?.token === input.token;
  } catch {
    return false;
  }
}
