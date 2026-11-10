import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { readSealedHistoricalUserPartial } from "./data-export-historical-partial-storage.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const digest = /^[0-9a-f]{64}$/u;
type Result = "deleted" | "missing" | "cleaned" | "quarantined" | "busy";
/** Ambiguous/malformed SQL acknowledgements must never authorize physical deletion. */
function checkedRows(result: unknown): Record<string, unknown>[] | null {
  if (result === null || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return null;
  if (result.rows.some((row: unknown) => row === null || typeof row !== "object" || Array.isArray(row))) return null;
  return result.rows as Record<string, unknown>[];
}

function exactCleanupRow(result: unknown): Record<string, unknown> | null {
  const found = checkedRows(result);
  return found?.length === 1 ? (found[0] ?? null) : null;
}

type CleanupInput = {
  db: Pick<PgQueryExecutor, "withTransaction">;
  archiveRoot: string;
  authority: { exportId: string; verifiedGitHubUserId: number };
};

/** Reject unbound owners and untrusted archive roots before disk or DB IO. */
function validCleanupInput(input: CleanupInput): boolean {
  return (
    !!input?.db?.withTransaction &&
    uuid.test(input?.authority?.exportId) &&
    Number.isSafeInteger(input?.authority?.verifiedGitHubUserId) &&
    input.authority.verifiedGitHubUserId > 0 &&
    typeof input.archiveRoot === "string" &&
    path.isAbsolute(input.archiveRoot) &&
    path.resolve(input.archiveRoot) === input.archiveRoot &&
    path.basename(input.archiveRoot) === ".private-export-archives"
  );
}

type VerifiedCleanupCandidate = {
  tenantId: string;
  preflightId: string;
  sha256: string;
  byteLength: number;
};

type PhysicalCleanupResult = "deleted" | "missing" | "quarantined";

/** Admit only one exact original-user binding and bounded ZIP commitment. */
function validatedCleanupCandidate(candidate: Record<string, unknown> | null): VerifiedCleanupCandidate | null {
  if (
    typeof candidate?.tenant_id !== "string" ||
    candidate.tenant_id.length === 0 ||
    typeof candidate.preflight_id !== "string" ||
    !uuid.test(candidate.preflight_id) ||
    typeof candidate.expected_archive_sha256 !== "string" ||
    !digest.test(candidate.expected_archive_sha256)
  )
    return null;
  const rawBytes = candidate.expected_archive_bytes;
  if (
    !(
      (typeof rawBytes === "number" && Number.isSafeInteger(rawBytes)) ||
      (typeof rawBytes === "string" && /^[1-9]\d{0,7}$/u.test(rawBytes))
    )
  )
    return null;
  const byteLength = Number(rawBytes);
  if (byteLength < 1 || byteLength > 64 * 1024 * 1024) return null;
  return {
    tenantId: candidate.tenant_id,
    preflightId: candidate.preflight_id,
    sha256: candidate.expected_archive_sha256,
    byteLength,
  };
}

/** Unknown/ambiguous snapshots block physical cleanup, including crashed readers. */
function noCleanupBlockers(blocker: Record<string, unknown> | null): boolean {
  return (
    blocker?.held === false &&
    blocker.erasure === false &&
    blocker.reader === false &&
    blocker.private_zip_reader === false &&
    blocker.active_preflight === false
  );
}

/** Require a single-link, private, original-owner file of the committed size. */
function validPrivatePartialFile(stat: Stats, byteLength: number): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    stat.size === byteLength &&
    (stat.mode & 0o077) === 0 &&
    (typeof process.getuid !== "function" || stat.uid === process.getuid())
  );
}

function samePrivatePartialFile(before: Stats, after: Stats | null): boolean {
  return (
    after !== null &&
    after.dev === before.dev &&
    after.ino === before.ino &&
    after.size === before.size &&
    after.ctimeMs === before.ctimeMs &&
    after.mtimeMs === before.mtimeMs
  );
}

/** Called only inside the still-held original-user transaction and lock gates. */
async function deleteVerifiedHistoricalPartial(
  root: string,
  exportId: string,
  sha256: string,
  byteLength: number,
): Promise<PhysicalCleanupResult> {
  const file = path.join(root, `${exportId}.historical-private-partial-v3.zip`);
  const before = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!before) return "missing";
  if (!validPrivatePartialFile(before, byteLength)) return "quarantined";
  const bytes = await readSealedHistoricalUserPartial({ archiveRoot: root, exportId, sha256, byteLength });
  if (!bytes) return "quarantined";
  bytes.fill(0);
  const after = await lstat(file).catch(() => null);
  if (!samePrivatePartialFile(before, after)) return "quarantined";
  await unlink(file);
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return "deleted";
}

/**
 * Explicit/manual, SOURCE-ONLY. Never enumerate orphan filenames or expose
 * an HTTP/worker janitor. Destruction requires an immutable exact preflight
 * binding to the original numeric GitHub USER and ZIP SHA/size, a FAILED
 * export older than one hour, expired/revoked preflight, no active holds,
 * erasure or unsettled source-copy reservations. Unknown ZIPs stay put.
 * A durable private ZIP verification reservation (migration 0125) prevents
 * cleanup while internal read IO is outstanding, even across web workers.
 * Unresolved crashed readers are quarantined, NEVER cleared on a timer.
 * The manual-only procedure remains source-only, NOT a background janitor
 * or customer ZIP delivery (which remains NO_GO).
 */
export async function cleanupHistoricalUserPrivatePartial(input: CleanupInput): Promise<Result> {
  if (!validCleanupInput(input)) return "quarantined";
  const root = input.archiveRoot;
  const [folder, actual] = await Promise.all([lstat(root).catch(() => null), realpath(root).catch(() => null)]);
  if (
    !folder?.isDirectory() ||
    folder.isSymbolicLink() ||
    actual !== root ||
    (folder.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && folder.uid !== process.getuid())
  )
    return "quarantined";

  try {
    return await input.db.withTransaction(
      async (tx): Promise<Result> => {
        await tx.query("LOCK TABLE public.legal_holds IN SHARE MODE NOWAIT");
        const owned = exactCleanupRow(
          await tx.query(
            `SELECT e.tenant_id, p.id AS preflight_id,
                p.expected_archive_sha256, p.expected_archive_bytes
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
            AND e.status='failed'
            AND e.created_at < clock_timestamp()-INTERVAL '1 hour'
            AND (p.revoked_at IS NOT NULL OR p.expires_at <= clock_timestamp())
          FOR UPDATE OF e,i,p NOWAIT`,
            [input.authority.exportId, input.authority.verifiedGitHubUserId],
          ),
        );
        const candidate = validatedCleanupCandidate(owned);
        if (!candidate) return "quarantined";

        const locks = exactCleanupRow(
          await tx.query(
            "SELECT pg_try_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1)) AS acquired",
            [candidate.tenantId],
          ),
        );
        if (locks?.acquired !== true) return "busy";
        const blocker = exactCleanupRow(
          await tx.query(
            `SELECT
           EXISTS(SELECT 1 FROM public.legal_holds h
             WHERE lower(h.tenant_id)=lower($1) AND h.active=TRUE) AS held,
           EXISTS(SELECT 1 FROM public.erasure_requests er
             WHERE lower(er.tenant_id)=lower($1) AND er.dry_run=FALSE
               AND er.status IN ('running','completed')) AS erasure,
           EXISTS(SELECT 1 FROM public.artifact_export_copy_reservations r
             WHERE r.export_id=$2 AND r.released_at IS NULL) AS reader,
           EXISTS(SELECT 1 FROM public.historical_user_partial_read_reservations r
             WHERE r.export_id=$2 AND r.released_at IS NULL) AS private_zip_reader,
           EXISTS(SELECT 1 FROM public.historical_user_private_delivery_preflights p
             WHERE p.export_id=$2 AND p.revoked_at IS NULL
               AND p.expires_at>clock_timestamp()) AS active_preflight`,
            [candidate.tenantId, input.authority.exportId],
          ),
        );
        if (!noCleanupBlockers(blocker)) return "quarantined";

        const prior = checkedRows(
          await tx.query(
            "SELECT outcome FROM public.historical_user_partial_cleanup_events WHERE export_id=$1 AND original_github_user_id=$2",
            [input.authority.exportId, input.authority.verifiedGitHubUserId],
          ),
        );
        if (prior === null || prior.length > 1) return "quarantined";
        if (prior.length === 1) {
          return prior[0]?.outcome === "deleted" || prior[0]?.outcome === "missing" ? "cleaned" : "quarantined";
        }

        const result = await deleteVerifiedHistoricalPartial(
          root,
          input.authority.exportId,
          candidate.sha256,
          candidate.byteLength,
        );
        if (result === "quarantined") return result;
        const audit = exactCleanupRow(
          await tx.query(
            `INSERT INTO public.historical_user_partial_cleanup_events (
          export_id,original_github_user_id,preflight_id,
          archive_sha256,archive_byte_length,outcome
        ) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(export_id) DO NOTHING RETURNING outcome`,
            [
              input.authority.exportId,
              input.authority.verifiedGitHubUserId,
              candidate.preflightId,
              candidate.sha256,
              candidate.byteLength,
              result,
            ],
          ),
        );
        if (audit?.outcome !== result) throw new Error("Private historical cleanup audit not committed");
        return result;
      },
      { statementTimeoutMs: 10000 },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "55P03" || error.code === "57014"))
      return "busy";
    return "quarantined";
  }
}
