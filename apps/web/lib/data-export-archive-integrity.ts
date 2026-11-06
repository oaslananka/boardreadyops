import { createHash } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";
import { isValidExportSha256 } from "../../../packages/db/src/data-export-hex-digest.js";

const maxArchiveBytes = 64 * 1024 * 1024;
const maxReceiptBytes = 32 * 1024;
const receiptPath = "metadata/archive-integrity.json";
const metadataPaths = new Set([
  "metadata/repositories.json",
  "metadata/runs-findings.json",
  "metadata/reviews-audit.json",
  "metadata/review-comments.json",
  "metadata/review-workflow.json",
  "metadata/finding-collaboration.json",
  "metadata/artifacts.json",
]);
const artifactPath = /^objects\/[A-Za-z0-9_-]{1,128}\.bin$/u;
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** The ZIP digest is trusted only when independently obtained and bounded. */
function validArchiveClaim(archiveBytes: Buffer, trustedSha: string, exportId: string): boolean {
  return (
    Buffer.isBuffer(archiveBytes) &&
    archiveBytes.length > 0 &&
    archiveBytes.length <= maxArchiveBytes &&
    isValidExportSha256(trustedSha) &&
    digest(archiveBytes) === trustedSha &&
    typeof exportId === "string" &&
    exportId.length > 0 &&
    exportId.length <= 256 &&
    exportId.trim() === exportId
  );
}

/** Ignore neither duplicated paths nor undeclared files in the archive. */
function uniqueArchiveFiles(files: readonly { path: string; data: Buffer }[]): Map<string, Buffer> | null {
  const result = new Map<string, Buffer>();
  for (const file of files) {
    if (result.has(file.path)) return null;
    result.set(file.path, file.data);
  }
  return result;
}

/** Validate the immutable export identity, declared scope and exclusions. */
function validReceiptHeader(
  receipt: unknown,
  exportId: string,
): receipt is Record<string, unknown> & { entries: unknown[] } {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const record = receipt as Record<string, unknown>;
  const exclusions = record.excludes;
  return (
    record.kind === "boardreadyops.claimed-export-integrity-receipt" &&
    record.formatVersion === 1 &&
    record.exportId === exportId &&
    record.scope === "bounded-platform-data-only" &&
    Array.isArray(exclusions) &&
    exclusions.length === 2 &&
    exclusions[0] === "github-repository-source" &&
    exclusions[1] === "github-actions-logs-and-artifacts" &&
    Array.isArray(record.entries)
  );
}

/** Exact path, immutable bytes and digest: no manifest entry may be inferred. */
function validReceiptEntry(candidate: unknown, path: string, bytes: Buffer | undefined): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const entry = candidate as Record<string, unknown>;
  return (
    !!bytes &&
    entry.path === path &&
    typeof entry.byteLength === "number" &&
    Number.isSafeInteger(entry.byteLength) &&
    entry.byteLength === bytes.length &&
    isValidExportSha256(entry.sha256) &&
    digest(bytes) === entry.sha256
  );
}

/** Exactly seven required metadata slices and only bounded artifact objects. */
function validReceiptEntries(entries: readonly unknown[], files: Map<string, Buffer>): boolean {
  const paths = [...files.keys()].filter((path) => path !== receiptPath).sort((a, b) => a.localeCompare(b));
  if (entries.length !== paths.length) return false;
  if ([...metadataPaths].some((path) => !files.has(path))) return false;
  if (paths.some((path) => !metadataPaths.has(path) && !artifactPath.test(path))) return false;
  return entries.every((candidate, index) => {
    const path = paths[index];
    return path !== undefined && validReceiptEntry(candidate, path, files.get(path));
  });
}

/**
 * Verifies a complete bounded export ZIP against a digest obtained from an
 * independent, trusted delivery record. Never trust a hash supplied inside
 * the ZIP as proof of publisher identity or customer authorization.
 *
 * This only verifies byte-level integrity and declared scope, NOT live
 * installation/repository permission, publication, or delivery rights.
 */
export function verifyClaimedExportArchiveIntegrity(
  archiveBytes: Buffer,
  trustedZipSha256: string,
  expectedExportId: string,
): boolean {
  if (!validArchiveClaim(archiveBytes, trustedZipSha256, expectedExportId)) return false;

  try {
    const extracted = sanitizeAndExtractArchive(archiveBytes, {
      maxCompressedSizeBytes: maxArchiveBytes,
      maxSingleFileBytes: maxArchiveBytes,
      maxTotalExtractedBytes: maxArchiveBytes,
      maxFiles: 108,
    });
    if (extracted.fileCount < 8 || extracted.fileCount > 108) return false;
    const files = uniqueArchiveFiles(extracted.files);
    if (!files) return false;
    const rawReceipt = files.get(receiptPath);
    if (!rawReceipt || rawReceipt.length === 0 || rawReceipt.length > maxReceiptBytes) return false;
    const receipt: unknown = JSON.parse(rawReceipt.toString("utf8"));
    return validReceiptHeader(receipt, expectedExportId) && validReceiptEntries(receipt.entries, files);
  } catch {
    // Corrupted, oversized, ambiguously named or unparseable archives fail
    // closed without reflecting private filenames or parser diagnostics.
    return false;
  }
}
