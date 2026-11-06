import { createHash } from "node:crypto";
import { isHistoricalUserUuid } from "./data-export-historical-uuid.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";
import type { PgQueryExecutor } from "./pg-executor.js";

const oauthState = /^[A-Za-z0-9_-]{43}$/u;
const domain = "boardreadyops-original-user-oauth-state-v1";
// Conservative, per-export quota; consumed/failed OAuth steps still count,
// avoiding unbounded append-only audit growth from retries or repeated aborts.
// The tenant advisory lock serializes each quota read plus INSERT.
const maximumChallengesPerFiveMinutes = 24;
const maximumChallengesPerExport = 128;

type OriginalUserNonce = {
  exportId: string;
  verifiedGitHubUserId: number;
  state: string;
};

function valid(input: unknown): input is OriginalUserNonce {
  if (input === null || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate.exportId === "string" &&
    isHistoricalUserUuid(candidate.exportId) &&
    typeof candidate.verifiedGitHubUserId === "number" &&
    Number.isSafeInteger(candidate.verifiedGitHubUserId) &&
    candidate.verifiedGitHubUserId > 0 &&
    typeof candidate.state === "string" &&
    oauthState.test(candidate.state)
  );
}

function hasTransaction(db: unknown): db is NonceDb {
  return db !== null && typeof db === "object" && "withTransaction" in db && typeof db.withTransaction === "function";
}

function digest(state: string): string {
  return createHash("sha256").update(domain).update("\0").update(state).digest("hex");
}

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (result === null || typeof result !== "object" || !("rows" in result)) return [];
  const values = result.rows;
  if (
    !Array.isArray(values) ||
    !values.every((row: unknown) => row !== null && typeof row === "object" && !Array.isArray(row))
  )
    return [];
  return values as Record<string, unknown>[];
}

function acknowledgedNonceDigest(result: unknown, expectedDigest: string): boolean {
  const entries = rows(result);
  // A malformed DB/adapter result cannot acknowledge a state change. The
  // returned SHA-256 must refer to this exact original-user OAuth challenge.
  return entries.length === 1 && entries[0]?.state_sha256 === expectedDigest;
}

type NonceDb = Pick<PgQueryExecutor, "withTransaction">;

/**
 * Align OAuth challenge lifecycle with the existing historical USER
 * preflight's LOCK TABLE -> original-user row lock -> tenant advisory
 * lock order. A legal-hold write cannot pass the gate mid-transaction,
 * and real erasure writers share the advisory xact key (migration 0117).
 * TRY-lock denies immediately if an erasure writer owns the tenant key.
 * These locks are NEVER held during GitHub HTTP, redirect
 * or callback response. Contention fails CLOSED; no customer capability.
 */
async function withOriginalUserNonceAdmission(
  db: NonceDb,
  input: OriginalUserNonce,
  apply: (tx: SqlQueryExecutor) => Promise<boolean>,
): Promise<boolean> {
  if (!hasTransaction(db) || !valid(input)) return false;
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
         WHERE e.id=$1 AND e.original_github_user_id=$2::bigint
           AND e.scope='user' AND e.installation_id IS NULL
           AND e.requested_by='github_app_uninstall'
           AND e.status='pending' AND lower(e.scope_id)=lower(e.tenant_id)
           AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
         FOR SHARE OF e,i NOWAIT`,
            [input.exportId, input.verifiedGitHubUserId],
          ),
        );
        const tenant = owner[0]?.tenant_id;
        if (typeof tenant !== "string" || tenant.length === 0) return false;
        const tenantLock = rows(
          await tx.query(
            "SELECT pg_try_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1)) AS acquired",
            [tenant],
          ),
        );
        if (tenantLock[0]?.acquired !== true) return false;
        const blockers = rows(
          await tx.query(
            `SELECT EXISTS(
          SELECT 1 FROM public.legal_holds h
           WHERE lower(h.tenant_id)=lower($1) AND h.active=TRUE
        ) AS active_hold,
        EXISTS(
          SELECT 1 FROM public.erasure_requests er
           WHERE lower(er.tenant_id)=lower($1)
             AND er.dry_run=FALSE AND er.status IN ('running','completed')
        ) AS active_erasure`,
            [tenant],
          ),
        );
        if (blockers[0]?.active_hold !== false || blockers[0]?.active_erasure !== false) return false;
        return await apply(tx);
      },
      { statementTimeoutMs: 5000 },
    );
  } catch {
    // Lock contention, timeout, missing schema or another transaction
    // failure may not permit a nonce to be minted or consumed.
    return false;
  }
}

/** Stores only a fresh random nonce digest. Exact original USER, suspended
 * installation and pending unexpired export must exist; holds and real
 * erasure block issuance. The existing tenant transaction key serializes
 * an append-only rolling and lifetime challenge quota across workers.
 * No old or consumed audit records are deleted. This is NOT a customer
 * export capability. */
export async function registerHistoricalUserOAuthChallenge(db: NonceDb, input: OriginalUserNonce): Promise<boolean> {
  return withOriginalUserNonceAdmission(db, input, async (tx) => {
    const stateDigest = digest(input.state);
    const result = await tx.query(
      `INSERT INTO public.historical_user_oauth_challenges(
       state_sha256,export_id,original_github_user_id,created_at,expires_at
     )
     SELECT $3,e.id,e.original_github_user_id,
            statement_timestamp(),statement_timestamp()+INTERVAL '5 minutes'
       FROM public.data_exports e
      WHERE e.id=$1 AND e.original_github_user_id=$2::bigint
        AND e.scope='user' AND e.installation_id IS NULL
        AND e.requested_by='github_app_uninstall' AND e.status='pending'
        AND lower(e.scope_id)=lower(e.tenant_id)
        AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
        AND EXISTS (
          SELECT 1 FROM public.installations i
           WHERE i.account_user_id=e.original_github_user_id
             AND lower(i.account_login)=lower(e.tenant_id)
             AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.legal_holds h
           WHERE lower(h.tenant_id)=lower(e.tenant_id) AND h.active=TRUE
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.erasure_requests er
           WHERE lower(er.tenant_id)=lower(e.tenant_id)
             AND er.dry_run=FALSE AND er.status IN ('running','completed')
        )
        AND (
          SELECT COUNT(*) FROM public.historical_user_oauth_challenges recent
           WHERE recent.export_id=e.id
             AND recent.created_at > clock_timestamp()-INTERVAL '5 minutes'
        ) < $4::integer
        AND (
          SELECT COUNT(*) FROM public.historical_user_oauth_challenges prior
           WHERE prior.export_id=e.id
        ) < $5::integer
     ON CONFLICT(state_sha256) DO NOTHING
     RETURNING state_sha256`,
      [
        input.exportId,
        input.verifiedGitHubUserId,
        stateDigest,
        maximumChallengesPerFiveMinutes,
        maximumChallengesPerExport,
      ],
    );
    return acknowledgedNonceDigest(result, stateDigest);
  });
}

/** Atomic compare-and-swap BEFORE GitHub code exchange. PostgreSQL row
 * locks guarantee one winning callback under concurrency; a failed
 * provider call cannot restore a consumed challenge. */
export async function consumeHistoricalUserOAuthChallenge(db: NonceDb, input: OriginalUserNonce): Promise<boolean> {
  return withOriginalUserNonceAdmission(db, input, async (tx) => {
    const stateDigest = digest(input.state);
    const result = await tx.query(
      `UPDATE public.historical_user_oauth_challenges challenge
        SET consumed_at=clock_timestamp()
       FROM public.data_exports e
      WHERE challenge.state_sha256=$3
        AND challenge.export_id=$1 AND challenge.original_github_user_id=$2::bigint
        AND challenge.consumed_at IS NULL AND challenge.expires_at>clock_timestamp()
        AND e.id=challenge.export_id
        AND e.original_github_user_id=challenge.original_github_user_id
        AND e.scope='user' AND e.installation_id IS NULL
        AND e.requested_by='github_app_uninstall' AND e.status='pending'
        AND lower(e.scope_id)=lower(e.tenant_id)
        AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
        AND EXISTS (
          SELECT 1 FROM public.installations i
           WHERE i.account_user_id=e.original_github_user_id
             AND lower(i.account_login)=lower(e.tenant_id)
             AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.legal_holds h
           WHERE lower(h.tenant_id)=lower(e.tenant_id) AND h.active=TRUE
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.erasure_requests er
           WHERE lower(er.tenant_id)=lower(e.tenant_id)
             AND er.dry_run=FALSE AND er.status IN ('running','completed')
        )
     RETURNING challenge.state_sha256`,
      [input.exportId, input.verifiedGitHubUserId, stateDigest],
    );
    return acknowledgedNonceDigest(result, stateDigest);
  });
}
