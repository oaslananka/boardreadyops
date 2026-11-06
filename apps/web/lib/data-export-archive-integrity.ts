import { createHash } from "node:crypto";
import { sanitizeAndExtractArchive } from "@boardreadyops/cloud-core/archive-sanitizer";

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
  if (
    !Buffer.isBuffer(archiveBytes) ||
    archiveBytes.length === 0 ||
    archiveBytes.length > maxArchiveBytes ||
    typeof trustedZipSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(trustedZipSha256) ||
    digest(archiveBytes) !== trustedZipSha256 ||
    typeof expectedExportId !== "string" ||
    expectedExportId.length === 0 ||
    expectedExportId.length > 256 ||
    expectedExportId.trim() !== expectedExportId
  ) {
    return false;
  }

  try {
    const extracted = sanitizeAndExtractArchive(archiveBytes, {
      maxCompressedSizeBytes: maxArchiveBytes,
      maxSingleFileBytes: maxArchiveBytes,
      maxTotalExtractedBytes: maxArchiveBytes,
      maxFiles: 108,
    });
    if (extracted.fileCount < 8 || extracted.fileCount > 108) return false;
    const files = new Map<string, Buffer>();
    for (const file of extracted.files) {
      if (files.has(file.path)) return false;
      files.set(file.path, file.data);
    }
    const rawReceipt = files.get(receiptPath);
    if (!rawReceipt || rawReceipt.length === 0 || rawReceipt.length > maxReceiptBytes) return false;
    const receipt: unknown = JSON.parse(rawReceipt.toString("utf8"));
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
    const record = receipt as Record<string, unknown>;
    const exclusions = record.excludes;
    if (
      record.kind !== "boardreadyops.claimed-export-integrity-receipt" ||
      record.formatVersion !== 1 ||
      record.exportId !== expectedExportId ||
      record.scope !== "bounded-platform-data-only" ||
      !Array.isArray(exclusions) ||
      exclusions.length !== 2 ||
      exclusions[0] !== "github-repository-source" ||
      exclusions[1] !== "github-actions-logs-and-artifacts" ||
      !Array.isArray(record.entries)
    ) {
      return false;
    }

    const paths = [...files.keys()].filter((path) => path !== receiptPath).sort((a, b) => a.localeCompare(b));
    if (record.entries.length !== paths.length) return false;
    if ([...metadataPaths].some((path) => !files.has(path))) return false;
    if (paths.some((path) => !metadataPaths.has(path) && !artifactPath.test(path))) return false;

    for (const [index, candidate] of record.entries.entries()) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      const entry = candidate as Record<string, unknown>;
      const path = paths[index];
      const bytes = path ? files.get(path) : undefined;
      if (
        !bytes ||
        entry.path !== path ||
        typeof entry.byteLength !== "number" ||
        !Number.isSafeInteger(entry.byteLength) ||
        entry.byteLength !== bytes.length ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
        digest(bytes) !== entry.sha256
      ) {
        return false;
      }
    }
    return true;
  } catch {
    // Corrupted, oversized, ambiguously named or unparseable archives fail
    // closed without reflecting private filenames or parser diagnostics.
    return false;
  }
}
