import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { verifyClaimedExportArchiveIntegrity } from "./data-export-archive-integrity.js";

const maxArchiveBytes = 64 * 1024 * 1024;
const exportIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const validSha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

export type SealedLocalExportArchive = {
  readonly exportId: string;
  readonly sha256: string;
  readonly byteLength: number;
};

async function privateArchiveDirectory(root: string): Promise<string | null> {
  if (typeof root !== "string" || root.length === 0 || root.trim() !== root) return null;
  const resolved = path.resolve(root);
  const [file, actual] = await Promise.all([lstat(resolved).catch(() => null), realpath(resolved).catch(() => null)]);
  if (
    !file?.isDirectory() ||
    file.isSymbolicLink() ||
    actual !== resolved ||
    (file.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && file.uid !== process.getuid())
  ) {
    return null;
  }
  return resolved;
}

/**
 * Opt-in worker provisioning inside the ALREADY mounted artifact Docker volume.
 * Reuse one local volume without widening public artifact read permissions:
 * only a reserved, owner-private sibling directory under the artifact root.
 * Never chmod an existing directory or follow symlinks. No root is created
 * when archive preparation is not explicitly configured.
 */
export async function ensurePrivateLocalExportArchiveDirectory(input: {
  storageRoot: string;
  privateArchiveRoot: string;
}): Promise<boolean> {
  if (typeof input?.storageRoot !== "string" || typeof input?.privateArchiveRoot !== "string") return false;
  if (!path.isAbsolute(input.storageRoot) || !path.isAbsolute(input.privateArchiveRoot)) return false;
  const parent = path.resolve(input.storageRoot);
  const archiveRoot = path.resolve(input.privateArchiveRoot);
  if (archiveRoot !== path.join(parent, ".private-export-archives")) return false;
  const [parentInfo, parentReal] = await Promise.all([
    lstat(parent).catch(() => null),
    realpath(parent).catch(() => null),
  ]);
  if (
    !parentInfo?.isDirectory() ||
    parentInfo.isSymbolicLink() ||
    parentReal !== parent ||
    (parentInfo.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && parentInfo.uid !== process.getuid())
  )
    return false;
  try {
    await mkdir(archiveRoot, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
  }
  return (await privateArchiveDirectory(archiveRoot)) === archiveRoot;
}

/** Bounded private read; caller must independently recheck current DB requester authority. */
export async function readSealedLocalExportArchive(input: {
  archiveRoot: string;
  exportId: string;
  sha256: string;
  byteLength: number;
}): Promise<Buffer | null> {
  if (
    !exportIdPattern.test(input.exportId) ||
    !validSha(input.sha256) ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > maxArchiveBytes
  ) {
    return null;
  }
  const root = await privateArchiveDirectory(input.archiveRoot);
  if (!root) return null;
  const filename = path.join(root, `${input.exportId}.zip`);
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const file = await open(filename, flags).catch(() => null);
  if (!file) return null;
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      stat.size !== input.byteLength
    ) {
      return null;
    }
    const bytes = await file.readFile();
    if (bytes.length !== input.byteLength) return null;
    const after = await file.stat();
    if (after.size !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs) return null;
    return verifyClaimedExportArchiveIntegrity(bytes, input.sha256, input.exportId) ? bytes : null;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

/**
 * Filesystem-only, not a publication or download permission.
 *
 * Requires a separately provisioned private (0700, same-UID, realpath-clean)
 * directory, NEVER an artifact/public upload path. Write -> fsync -> atomic
 * hard-link(no clobber) -> unlink temp -> fsync directory. A failed DB stage
 * may leave a private orphan for a future audited retention cleanup; never
 * blindly delete a file another worker might have committed.
 */
export async function sealLocalExportArchive(input: {
  archiveRoot: string;
  exportId: string;
  archive: { readonly bytes: Buffer; readonly sha256: string; readonly byteLength: number };
}): Promise<SealedLocalExportArchive | null> {
  const { archive, exportId } = input;
  if (
    !exportIdPattern.test(exportId) ||
    !archive ||
    !Buffer.isBuffer(archive.bytes) ||
    archive.bytes.length < 1 ||
    archive.bytes.length > maxArchiveBytes ||
    archive.byteLength !== archive.bytes.length ||
    !validSha(archive.sha256) ||
    !verifyClaimedExportArchiveIntegrity(archive.bytes, archive.sha256, exportId)
  ) {
    return null;
  }
  const root = await privateArchiveDirectory(input.archiveRoot);
  if (!root) return null;
  const name = path.join(root, `${exportId}.zip`);
  const temporary = path.join(root, `.${exportId}.${randomUUID()}.tmp`);
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await file.writeFile(archive.bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    // No overwrite: if the export ID already exists, require identical
    // independently verified bytes rather than replacing an earlier archive.
    try {
      await link(temporary, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    // A failed write, fsync or hard-link must not strand an accessible partial
    // temporary file; a prior successfully sealed destination is untouched.
    await unlink(temporary).catch(() => {});
  }

  // Persist the directory entry for crash recovery before staging any DB
  // commitment. A failed fsync fails closed, leaving only private bytes.
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }

  const verified = await readSealedLocalExportArchive({
    archiveRoot: root,
    exportId,
    sha256: archive.sha256,
    byteLength: archive.byteLength,
  });
  return verified ? { exportId, sha256: archive.sha256, byteLength: archive.byteLength } : null;
}
