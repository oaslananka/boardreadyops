import { createHash } from "node:crypto";
import { createZipBuffer } from "../../../src/util/zip.js";
import { ExportArchivePreflightError, prepareClaimedArchiveEntries } from "./data-export-archive-entries.js";

const maxArchiveBytes = 64 * 1024 * 1024;
const maxReceiptBytes = 32 * 1024;
const receiptPath = "metadata/archive-integrity.json";
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

  // Give the eventual recipient a deterministic, per-entry checksum inventory.
  // The receipt intentionally does NOT hash itself, and cannot prove the
  // publisher's identity: the complete ZIP digest must be independently
  // authenticated by any future download/retrieval edge.
  const repositories = entries.find((entry) => entry.path === "metadata/repositories.json");
  if (!repositories) throw new ExportArchivePreflightError();
  const exportId = (JSON.parse(repositories.bytes.toString("utf8")) as { exportId: string }).exportId;
  const receiptBytes = Buffer.from(
    JSON.stringify({
      kind: "boardreadyops.claimed-export-integrity-receipt",
      formatVersion: 1,
      exportId,
      scope: "bounded-platform-data-only",
      // Customer source, workflow logs and GitHub Actions artifacts remain
      // inside the customer's GitHub boundary, not BoardReadyOps storage.
      excludes: ["github-repository-source", "github-actions-logs-and-artifacts"],
      entries: entries.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
    }),
  );
  if (
    receiptBytes.length > maxReceiptBytes ||
    !Number.isSafeInteger(prepared.totalBytes + receiptBytes.length) ||
    prepared.totalBytes + receiptBytes.length > maxArchiveBytes
  ) {
    throw new ExportArchivePreflightError();
  }
  entries.push({
    path: receiptPath,
    bytes: receiptBytes,
    sha256: createHash("sha256").update(receiptBytes).digest("hex"),
    byteLength: receiptBytes.length,
  });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Reuse the repository's established ZIP writer; no external service, disk,
  // secret or database mutation. Fail closed if ZIP framing exceeds the budget.
  const bytes = createZipBuffer(
    entries.map((entry) => ({
      name: entry.path,
      data: entry.bytes,
      // Managed bytes may be legitimate but extremely compressible. Storing
      // them avoids the ZIP-bomb ratio rejection in independent extractors
      // without changing their security thresholds or shared writer defaults.
      store: entry.path.startsWith("objects/"),
    })),
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
