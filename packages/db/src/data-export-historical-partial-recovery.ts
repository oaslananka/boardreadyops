import { isHistoricalUserUuid } from "./data-export-historical-uuid.js";
import type { PgQueryExecutor } from "./pg-executor.js";

type RecoveryInput = {
  db: Pick<PgQueryExecutor, "withTransaction">;
  authority: { exportId: string; verifiedGitHubUserId: number };
  preflightId: string;
};

function validRecoveryInput(input: unknown): input is RecoveryInput {
  if (input === null || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  if (
    candidate.db === null ||
    typeof candidate.db !== "object" ||
    !("withTransaction" in candidate.db) ||
    typeof candidate.db.withTransaction !== "function"
  )
    return false;
  if (candidate.authority === null || typeof candidate.authority !== "object") return false;
  const authority = candidate.authority as Record<string, unknown>;
  return (
    typeof authority.exportId === "string" &&
    isHistoricalUserUuid(authority.exportId) &&
    typeof authority.verifiedGitHubUserId === "number" &&
    Number.isSafeInteger(authority.verifiedGitHubUserId) &&
    authority.verifiedGitHubUserId > 0 &&
    typeof candidate.preflightId === "string" &&
    isHistoricalUserUuid(candidate.preflightId)
  );
}

type RecoveryAssessment =
  | { status: "unverified" | "busy" | "legal_hold" | "real_erasure"; releaseAllowed: false }
  | { status: "active_export" | "no_unresolved"; releaseAllowed: false; unresolvedReaders: number }
  | {
      status: "manual_host_review";
      releaseAllowed: false;
      unresolvedReaders: number;
      oldestReaderStartedAt: string;
      workerLivenessProven: false;
    };

function exactRecoveryRow(result: unknown): Record<string, unknown> | null {
  if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return null;
  if (result.rows.length !== 1) return null;
  const row: unknown = result.rows[0];
  return row !== null && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
}

/**
 * Operator-side SOURCE-ONLY, read-only evidence assessment. Never releases
 * a reservation, unlocks cleanup, decides that a reader is dead, or exposes
 * raw reservation tokens, ZIP bytes, paths, GitHub credentials or identity.
 *
 * A clock age does NOT prove host/process death. Migration 0125 does not
 * record a verifiable live worker identity. Even a failed export with a
 * revoked/expired preflight must retain every unresolved reservation until
 * an independent, future worker-liveness/fencing protocol is accepted.
 */
export async function assessHistoricalUserPrivateReadRecovery(input: RecoveryInput): Promise<RecoveryAssessment> {
  const denied: RecoveryAssessment = { status: "unverified", releaseAllowed: false };
  if (!validRecoveryInput(input)) return denied;
  try {
    return await input.db.withTransaction(
      async (tx): Promise<RecoveryAssessment> => {
        await tx.query("LOCK TABLE public.legal_holds IN SHARE MODE NOWAIT");
        const original = exactRecoveryRow(
          await tx.query(
            `SELECT e.tenant_id, (e.status='failed' AND e.created_at <
                   clock_timestamp()-INTERVAL '1 hour') AS failed_aged,
                 (p.revoked_at IS NOT NULL OR
                   p.expires_at <= clock_timestamp()) AS preflight_inactive
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
             AND p.id=$3::uuid
             AND p.customer_delivery_allowed=FALSE
             AND p.complete_customer_export=FALSE
           FOR SHARE OF e,i,p NOWAIT`,
            [input.authority.exportId, input.authority.verifiedGitHubUserId, input.preflightId],
          ),
        );
        if (typeof original?.tenant_id !== "string" || original.tenant_id.length === 0) return denied;
        const lock = exactRecoveryRow(
          await tx.query(
            "SELECT pg_try_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1)) AS acquired",
            [original.tenant_id],
          ),
        );
        if (!lock) return denied;
        if (lock.acquired !== true) return { status: "busy", releaseAllowed: false };
        const blockers = exactRecoveryRow(
          await tx.query(
            `SELECT EXISTS(
           SELECT 1 FROM public.legal_holds h
            WHERE lower(h.tenant_id)=lower($1) AND h.active=TRUE
         ) AS held,
         EXISTS(
           SELECT 1 FROM public.erasure_requests er
            WHERE lower(er.tenant_id)=lower($1)
              AND er.dry_run=FALSE AND er.status IN ('running','completed')
         ) AS erasure`,
            [original.tenant_id],
          ),
        );
        if (!blockers) return denied;
        if (blockers.held !== false) return { status: "legal_hold", releaseAllowed: false };
        if (blockers.erasure !== false) return { status: "real_erasure", releaseAllowed: false };
        const count = exactRecoveryRow(
          await tx.query(
            `SELECT COUNT(*)::integer AS n, MIN(started_at) AS oldest
           FROM public.historical_user_partial_read_reservations
          WHERE export_id=$1 AND original_github_user_id=$2::bigint
            AND preflight_id=$3::uuid AND released_at IS NULL`,
            [input.authority.exportId, input.authority.verifiedGitHubUserId, input.preflightId],
          ),
        );
        if (!count) return denied;
        const total = count.n;
        if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) return denied;
        if (total === 0) return { status: "no_unresolved", releaseAllowed: false, unresolvedReaders: 0 };

        // DB clock avoids operator/worker clock skew; never proves death.
        const ageEligible = original.failed_aged === true && original.preflight_inactive === true;
        if (!ageEligible) return { status: "active_export", releaseAllowed: false, unresolvedReaders: Number(total) };
        if (!(count.oldest instanceof Date) || !Number.isFinite(count.oldest.getTime())) return denied;
        return {
          status: "manual_host_review",
          releaseAllowed: false,
          unresolvedReaders: Number(total),
          oldestReaderStartedAt: count.oldest.toISOString(),
          workerLivenessProven: false,
        };
      },
      { statementTimeoutMs: 5000 },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "55P03" || error.code === "57014")) {
      return { status: "busy", releaseAllowed: false };
    }
    return denied;
  }
}
