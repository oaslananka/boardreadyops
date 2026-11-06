import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { DataExportArchiveCommitmentStore } from "../../../packages/db/src/data-export-archive-commitment-store.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { readSealedLocalExportArchive } from "./data-export-local-archive-storage.js";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

export type ArchiveCleanupResult =
  | "deleted"
  | "missing"
  | "active"
  | "hold"
  | "cleaned"
  | "unknown"
  | "quarantined"
  | "busy";

type CleanupInput = {
  db: Pick<PgQueryExecutor, "withTransaction">;
  archiveRoot: string;
  exportId: string;
  tenantId: string;
  installationId: string;
};

type PhysicalCleanupOutcome = "deleted" | "missing" | "quarantined";

/** Reject malformed cleanup scope before any filesystem or database IO. */
function validCleanupInput(input: CleanupInput): boolean {
  return (
    !!input?.db?.withTransaction &&
    uuid.test(input.exportId) &&
    typeof input.tenantId === "string" &&
    !!input.tenantId &&
    typeof input.installationId === "string" &&
    !!input.installationId &&
    typeof input.archiveRoot === "string" &&
    path.isAbsolute(input.archiveRoot) &&
    path.basename(input.archiveRoot) === ".private-export-archives"
  );
}

/** Require the original physical file to be single-linked and owner-private. */
function validCleanupFile(stat: Stats, byteLength: number): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    stat.size === byteLength &&
    (stat.mode & 0o077) === 0 &&
    (typeof process.getuid !== "function" || stat.uid === process.getuid())
  );
}

/** Refuse unlink when the path was swapped or changed during verification. */
function sameCleanupFile(before: Stats, after: Stats | null): boolean {
  return (
    after !== null &&
    after.dev === before.dev &&
    after.ino === before.ino &&
    after.size === before.size &&
    after.mtimeMs === before.mtimeMs
  );
}

/**
 * Call only while the commitment row + legal-hold locks are held. All
 * checksum, path identity and durable fsync fences precede the DB audit.
 */
async function deleteVerifiedCleanupFile(
  root: string,
  exportId: string,
  sha256: string,
  byteLength: number,
): Promise<PhysicalCleanupOutcome> {
  const fileName = path.join(root, `${exportId}.zip`);
  const before = await lstat(fileName).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!before) return "missing";
  if (!validCleanupFile(before, byteLength)) return "quarantined";
  const bytes = await readSealedLocalExportArchive({ archiveRoot: root, exportId, sha256, byteLength });
  if (!bytes) return "quarantined";
  bytes.fill(0);
  const after = await lstat(fileName).catch(() => null);
  if (!sameCleanupFile(before, after)) return "quarantined";
  await unlink(fileName);
  // Persist directory entry deletion before recording the audit outcome.
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return "deleted";
}

/**
 * INTERNAL opt-in cleanup for an EXACT original-claim-bound, expired/revoked
 * archive. Never enumerate, infer, or delete unbound orphan ZIPs: a missing
 * database commitment cannot prove tenant ownership or legal-hold status.
 *
 * PostgreSQL holds a NOWAIT SHARE table lock across every legal_holds writer
 * and a commitment FOR UPDATE row lock while filesystem identity is verified,
 * unlinked and fsynced. The append-only audit and cleanup marker commit
 * together; a failed DB commit after unlink is recoverable as missing on
 * an explicit later retry. Never called automatically or by public HTTP.
 */
export async function cleanupExpiredPrivateLocalExportArchive(input: CleanupInput): Promise<ArchiveCleanupResult> {
  if (!validCleanupInput(input)) return "quarantined";

  const root = path.resolve(input.archiveRoot);
  const stat = await lstat(root).catch(() => null);
  const actual = await realpath(root).catch(() => null);
  if (
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    actual !== root ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    return "quarantined";

  try {
    return await input.db.withTransaction(
      async (tx): Promise<ArchiveCleanupResult> => {
        const store = new DataExportArchiveCommitmentStore(tx);
        const request = {
          exportId: input.exportId,
          tenantId: input.tenantId,
          installationId: input.installationId,
        };
        const candidate = await store.lockCleanupCandidate(request);
        if (!candidate) return "unknown";
        if (candidate.disposition !== "eligible") return candidate.disposition;

        const outcome = await deleteVerifiedCleanupFile(root, input.exportId, candidate.sha256, candidate.byteLength);
        if (outcome === "quarantined") return outcome;
        await store.markPhysicallyCleaned(request, outcome);
        return outcome;
      },
      { statementTimeoutMs: 10_000 },
    );
  } catch (error) {
    // Another transaction is writing a hold; fail closed rather than wait.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "55P03") return "busy";
    throw error;
  }
}
