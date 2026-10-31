import { createHash } from "node:crypto";
import { createZipBuffer } from "../../../src/util/zip.js";
import { ExportArchivePreflightError, prepareClaimedArchiveEntries } from "./data-export-archive-entries.js";

const maxArchiveBytes = 64 * 1024 * 1024;
/** Fixed DOS timestamp: deterministic across repeated packaging within a process. */
const archiveTimestamp = new Date(1980, 0, 1, 0, 0, 0);

/**
 * Deterministically ZIP only preflighted, claim-bound metadata and object
 * bytes. Caller must have independently authorized and verified every object.
 *
 * This is NOT a customer export, persisted archive, completion transition,
 * post-uninstall access grant, signed link or download capability.
 */
export function prepareClaimedArchiveZip(input: Parameters<typeof prepareClaimedArchiveEntries>[0]): {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly byteLength: number;
  readonly files: number;
} {
  const prepared = prepareClaimedArchiveEntries(input);
  if (prepared.entries.length < 7 || prepared.entries.length > 107 || prepared.totalBytes > maxArchiveBytes) {
    throw new ExportArchivePreflightError();
  }

  const names = new Set<string>();
  const entries = [...prepared.entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const entry of entries) {
    if (names.has(entry.path) || entry.bytes.length !== entry.byteLength) {
      throw new ExportArchivePreflightError();
    }
    names.add(entry.path);
  }

  // Reuse the repository's established ZIP writer; no external service, disk,
  // secret or database mutation. Fail closed if ZIP framing exceeds the budget.
  const bytes = createZipBuffer(
    entries.map((entry) => ({ name: entry.path, data: entry.bytes })),
    archiveTimestamp,
  );
  if (bytes.length > maxArchiveBytes) throw new ExportArchivePreflightError();
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    files: entries.length,
  };
}
