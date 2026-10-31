import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { resolveLocalArtifactFile } from "./artifact-downloads.js";

/** An explicitly bounded in-memory verification primitive, NOT export authorization. */
export const maxLocalExportObjectBytes = 64 * 1024 * 1024;

export type LocalExportObjectReference = {
  storagePath: string;
  sha256: string;
  byteLength: number;
};

function validRequest(input: {
  storageDriver: string;
  storageRoot: string;
  object: LocalExportObjectReference;
}): boolean {
  const { storageDriver, storageRoot, object } = input;
  return (
    storageDriver === "local" &&
    Boolean(storageRoot) &&
    Boolean(object) &&
    typeof object.storagePath === "string" &&
    Boolean(object.storagePath) &&
    typeof object.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(object.sha256) &&
    Number.isSafeInteger(object.byteLength) &&
    object.byteLength >= 0 &&
    object.byteLength <= maxLocalExportObjectBytes
  );
}

function sameStableFile(before: Stats, after: Stats): boolean {
  return (
    after.isFile() &&
    after.size === before.size &&
    after.dev === before.dev &&
    after.ino === before.ino &&
    after.mtimeMs === before.mtimeMs &&
    after.ctimeMs === before.ctimeMs
  );
}

async function readExactBytes(handle: FileHandle, length: number): Promise<Buffer | null> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
    if (!bytesRead) return null;
    offset += bytesRead;
  }
  return bytes;
}

/**
 * Read back the exact bytes of an ALREADY authorized local managed object.
 * A DB query must independently scope/authorize this reference; callers must
 * recheck expiry, active holds, deletion fences and requester authority after
 * this IO and again before any export is published or delivered.
 *
 * Fail closed on missing/unsafe/changed objects. No URL, status or DB write.
 */
export async function readVerifiedLocalExportObject(input: {
  storageDriver: string;
  storageRoot: string;
  object: LocalExportObjectReference;
}): Promise<Buffer | null> {
  if (!validRequest(input)) return null;
  const { storageRoot, object } = input;

  const resolution = await resolveLocalArtifactFile(storageRoot, object.storagePath);
  if (resolution.state !== "resolved") return null;
  let handle: FileHandle;
  try {
    handle = await open(resolution.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== object.byteLength) return null;
    const bytes = await readExactBytes(handle, object.byteLength);
    if (!bytes) return null;
    const after = await handle.stat();
    if (!sameStableFile(before, after)) return null;
    if (createHash("sha256").update(bytes).digest("hex") !== object.sha256) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    try {
      await handle.close();
    } catch {
      // A failed close never turns an unsuccessful verification into authorization.
    }
  }
}
