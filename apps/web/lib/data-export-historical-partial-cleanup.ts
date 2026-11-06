import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { readSealedHistoricalUserPartial } from "./data-export-historical-partial-storage.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const digest = /^[0-9a-f]{64}$/u;
type Result = "deleted" | "missing" | "cleaned" | "quarantined" | "busy";
type Locked = {
  tenant_id: string;
  preflight_id: string;
  expected_archive_sha256: string;
  expected_archive_bytes: string | number;
};
function rows(result: unknown): Record<string, unknown>[] {
  return (result as { rows?: Record<string, unknown>[] })?.rows ?? [];
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
export async function cleanupHistoricalUserPrivatePartial(input: {
  db: Pick<PgQueryExecutor, "withTransaction">;
  archiveRoot: string;
  authority: { exportId: string; verifiedGitHubUserId: number };
}): Promise<Result> {
  if (
    !input?.db?.withTransaction ||
    !uuid.test(input?.authority?.exportId) ||
    !Number.isSafeInteger(input?.authority?.verifiedGitHubUserId) ||
    input.authority.verifiedGitHubUserId <= 0 ||
    typeof input.archiveRoot !== "string" ||
    !path.isAbsolute(input.archiveRoot) ||
    path.resolve(input.archiveRoot) !== input.archiveRoot ||
    path.basename(input.archiveRoot) !== ".private-export-archives"
  )
    return "quarantined";
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
        const owned = rows(
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
        ) as Locked[];
        const candidate = owned[0];
        if (
          !candidate?.tenant_id ||
          !uuid.test(candidate.preflight_id) ||
          !digest.test(candidate.expected_archive_sha256)
        )
          return "quarantined";
        const byteLength = Number(candidate.expected_archive_bytes);
        if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 64 * 1024 * 1024) return "quarantined";

        const locks = rows(
          await tx.query(
            "SELECT pg_try_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key($1)) AS acquired",
            [candidate.tenant_id],
          ),
        );
        if (locks[0]?.acquired !== true) return "busy";
        const blocker = rows(
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
            [candidate.tenant_id, input.authority.exportId],
          ),
        );
        if (
          blocker.length !== 1 ||
          blocker[0]?.held !== false ||
          blocker[0]?.erasure !== false ||
          blocker[0]?.reader !== false ||
          blocker[0]?.private_zip_reader !== false ||
          blocker[0]?.active_preflight !== false
        )
          return "quarantined";

        const prior = rows(
          await tx.query(
            "SELECT outcome FROM public.historical_user_partial_cleanup_events WHERE export_id=$1 AND original_github_user_id=$2",
            [input.authority.exportId, input.authority.verifiedGitHubUserId],
          ),
        );
        if (prior.length) return "cleaned";

        const file = path.join(root, `${input.authority.exportId}.historical-private-partial-v3.zip`);
        const before = await lstat(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (before) {
          if (
            !before.isFile() ||
            before.isSymbolicLink() ||
            before.nlink !== 1 ||
            before.size !== byteLength ||
            (before.mode & 0o077) !== 0 ||
            (typeof process.getuid === "function" && before.uid !== process.getuid())
          )
            return "quarantined";
          const bytes = await readSealedHistoricalUserPartial({
            archiveRoot: root,
            exportId: input.authority.exportId,
            sha256: candidate.expected_archive_sha256,
            byteLength,
          });
          if (!bytes) return "quarantined";
          bytes.fill(0);
          const after = await lstat(file).catch(() => null);
          if (
            !after ||
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.ctimeMs !== before.ctimeMs ||
            after.mtimeMs !== before.mtimeMs
          )
            return "quarantined";
          await unlink(file);
          const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }

        const result: "deleted" | "missing" = before ? "deleted" : "missing";
        const audit = rows(
          await tx.query(
            `INSERT INTO public.historical_user_partial_cleanup_events (
          export_id,original_github_user_id,preflight_id,
          archive_sha256,archive_byte_length,outcome
        ) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(export_id) DO NOTHING RETURNING outcome`,
            [
              input.authority.exportId,
              input.authority.verifiedGitHubUserId,
              candidate.preflight_id,
              candidate.expected_archive_sha256,
              byteLength,
              result,
            ],
          ),
        );
        if (audit.length !== 1) throw new Error("Private historical cleanup audit not committed");
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
