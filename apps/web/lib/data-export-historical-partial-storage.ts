import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, link, lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import {
  prepareVerifiedHistoricalUserPartialArchive,
  verifyHistoricalUserPartialArchive,
} from "./data-export-historical-archive.js";
import { ensurePrivateLocalExportArchiveDirectory } from "./data-export-local-archive-storage.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const maxBytes = 64 * 1024 * 1024;
const filenameFor = (exportId: string) => `${exportId}.historical-private-partial-v3.zip`;

export type SealedHistoricalUserPartial = {
  exportId: string;
  sha256: string;
  byteLength: number;
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
};

async function verifiedRoot(root: string): Promise<string | null> {
  if (
    typeof root !== "string" ||
    !path.isAbsolute(root) ||
    root !== path.resolve(root) ||
    path.basename(root) !== ".private-export-archives"
  )
    return null;
  const [info, actual] = await Promise.all([lstat(root).catch(() => null), realpath(root).catch(() => null)]);
  if (
    !info?.isDirectory() ||
    info.isSymbolicLink() ||
    actual !== root ||
    (info.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  )
    return null;
  return root;
}

function valid(input: { exportId: string; sha256: string; byteLength: number }): boolean {
  return (
    uuid.test(input?.exportId) &&
    sha256.test(input?.sha256) &&
    Number.isSafeInteger(input?.byteLength) &&
    input.byteLength > 0 &&
    input.byteLength <= maxBytes
  );
}

/**
 * A concurrent writer cannot make the ZIP reader allocate past the approved
 * preflight size. Probe the next byte to refuse appended content; a short
 * read is never a valid sealed archive. Caller owns and zeroes the result.
 */
async function readExactPrivateArchive(handle: FileHandle, expectedBytes: number): Promise<Buffer | null> {
  const bytes = Buffer.alloc(expectedBytes);
  const probe = Buffer.alloc(1);
  let accepted = false;
  try {
    let offset = 0;
    while (offset < expectedBytes) {
      const { bytesRead } = await handle.read(bytes, offset, expectedBytes - offset, offset);
      if (bytesRead === 0) return null;
      offset += bytesRead;
    }
    const { bytesRead: extra } = await handle.read(probe, 0, 1, expectedBytes);
    if (extra !== 0) return null;
    accepted = true;
    return bytes;
  } finally {
    probe.fill(0);
    if (!accepted) bytes.fill(0);
  }
}

/** SOURCE-ONLY private read. Revalidate original USER and legal holds
 * independently before any future use. NEVER serves customer bytes.
 */
export async function readSealedHistoricalUserPartial(input: {
  archiveRoot: string;
  exportId: string;
  sha256: string;
  byteLength: number;
}): Promise<Buffer | null> {
  if (!valid(input)) return null;
  const root = await verifiedRoot(input.archiveRoot);
  if (!root) return null;
  const handle = await open(
    path.join(root, filenameFor(input.exportId)),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch(() => null);
  if (!handle) return null;
  let bytes: Buffer | null = null;
  let accepted = false;
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      (before.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && before.uid !== process.getuid()) ||
      before.size !== input.byteLength
    )
      return null;
    bytes = await readExactPrivateArchive(handle, input.byteLength);
    if (!bytes) return null;
    const after = await handle.stat();
    if (
      bytes.length !== input.byteLength ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      return null;
    if (!verifyHistoricalUserPartialArchive(bytes, input.sha256, input.exportId)) return null;
    accepted = true; // Ownership of the verified buffer transfers to the caller.
    return bytes;
  } catch {
    return null;
  } finally {
    // Failed integrity validation must not retain private ZIP bytes in memory.
    if (!accepted) bytes?.fill(0);
    await handle.close();
  }
}

/** Private partial-only persistence: 0700 owner-private root, 0600
 * O_EXCL/O_NOFOLLOW staging, fsync file, hardlink no-clobber, unlink
 * temporary, fsync directory, independent original-USER ZIP v3 recheck.
 * No DB/filesystem atomic commitment, signature or customer delivery.
 */
export async function sealHistoricalUserPrivatePartial(input: {
  archiveRoot: string;
  exportId: string;
  archive: { bytes: Buffer; sha256: string; byteLength: number };
}): Promise<SealedHistoricalUserPartial | null> {
  if (
    !valid({ exportId: input?.exportId, sha256: input?.archive?.sha256, byteLength: input?.archive?.byteLength }) ||
    !Buffer.isBuffer(input.archive.bytes) ||
    input.archive.bytes.length !== input.archive.byteLength ||
    !verifyHistoricalUserPartialArchive(input.archive.bytes, input.archive.sha256, input.exportId)
  )
    return null;
  const root = await verifiedRoot(input.archiveRoot);
  if (!root) return null;
  const tmp = path.join(root, `.${input.exportId}.${randomUUID()}.historical-partial.tmp`);
  const dest = path.join(root, filenameFor(input.exportId));
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(input.archive.bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(tmp, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Existing private archive is never overwritten; final verification
      // rejects a different ZIP even when the export UUID is the same.
    }
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
  }
  try {
    const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    const bytes = await readSealedHistoricalUserPartial({
      archiveRoot: root,
      exportId: input.exportId,
      sha256: input.archive.sha256,
      byteLength: input.archive.byteLength,
    });
    try {
      return bytes?.equals(input.archive.bytes)
        ? {
            exportId: input.exportId,
            sha256: input.archive.sha256,
            byteLength: input.archive.byteLength,
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
          }
        : null;
    } finally {
      // This successful read is internal verification; only the input is caller-owned.
      bytes?.fill(0);
    }
  } catch {
    return null;
  }
}

/**
 * SOURCE-ONLY end-to-end private physical staging acceptance.
 *
 * 1. Independently authorize original numeric GitHub USER and verify EVERY
 *    retained artifact/manifest while preparing bounded partial ZIP v3.
 * 2. Fsync and no-clobber seal it under the existing private local volume.
 * 3. Re-read and re-verify the retained original USER + all physical
 *    objects AFTER the durable file write, rejecting intervening DB,
 *    retention, legal hold, erasure or artifact mutations.
 *
 * This is deliberately a diagnostic, NOT an atomic DB+filesystem
 * snapshot, external signature, live customer authorization, grant or
 * HTTP route. An unaccepted/failed attempt leaves private quarantined
 * bytes for later audited retention cleanup, never a customer download.
 */
export async function prepareSealedHistoricalUserPrivatePartial(input: {
  db: PgQueryExecutor;
  authority: { exportId: string; verifiedGitHubUserId: number };
  storageRoot: string;
  storageDriver: string;
}): Promise<SealedHistoricalUserPartial | null> {
  if (input?.storageDriver !== "local") return null;
  const root = path.join(input.storageRoot, ".private-export-archives");
  if (
    !(await ensurePrivateLocalExportArchiveDirectory({
      storageRoot: input.storageRoot,
      privateArchiveRoot: root,
    }))
  )
    return null;
  let initial: Awaited<ReturnType<typeof prepareVerifiedHistoricalUserPartialArchive>> = null;
  let confirmed: Awaited<ReturnType<typeof prepareVerifiedHistoricalUserPartialArchive>> = null;
  let disk: Buffer | null = null;
  try {
    initial = await prepareVerifiedHistoricalUserPartialArchive(input);
    if (!initial) return null;
    const persisted = await sealHistoricalUserPrivatePartial({
      archiveRoot: root,
      exportId: input.authority.exportId,
      archive: initial,
    });
    if (!persisted) return null;

    // A second complete original-USER/physical-object read is intentionally
    // bounded and refuses any stale source after disk fsync. There is STILL
    // no durable DB/FS atomic claim after this short-lived check.
    confirmed = await prepareVerifiedHistoricalUserPartialArchive(input);
    if (
      confirmed?.byteLength !== initial.byteLength ||
      confirmed.sha256 !== initial.sha256 ||
      !confirmed.bytes.equals(initial.bytes)
    )
      return null;
    disk = await readSealedHistoricalUserPartial({
      archiveRoot: root,
      exportId: input.authority.exportId,
      sha256: initial.sha256,
      byteLength: initial.byteLength,
    });
    return disk?.equals(initial.bytes) ? persisted : null;
  } catch {
    return null;
  } finally {
    // These are internal private snapshots, never caller-visible ZIP buffers.
    initial?.bytes.fill(0);
    confirmed?.bytes.fill(0);
    disk?.fill(0);
  }
}
