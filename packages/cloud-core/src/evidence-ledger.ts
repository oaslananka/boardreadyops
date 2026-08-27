import { createHash } from "node:crypto";
import {
  calculateEvidenceDigest,
  canonicalJsonStringify,
  type EvidenceItem,
  type EvidenceLedgerDocument,
  type LedgerApprovalRecord,
  type LedgerChecklistRecord,
  type LedgerDecisionRecord,
  type LedgerVerificationResult,
} from "@boardreadyops/contracts";

export { calculateEvidenceDigest, canonicalJsonStringify };

export function computeCanonicalHash(obj: unknown): string {
  const canonical = canonicalJsonStringify(obj);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildEvidenceLedger(input: {
  repository: string;
  baseSha: string;
  headSha: string;
  manifest: EvidenceItem[];
  decisions: LedgerDecisionRecord[];
  approvals: LedgerApprovalRecord[];
  checklist: LedgerChecklistRecord[];
  evidenceState?: "current" | "stale" | "invalid";
}): EvidenceLedgerDocument {
  const digest = calculateEvidenceDigest({
    manifest: input.manifest,
    decisions: input.decisions,
    approvals: input.approvals,
    checklist: input.checklist,
  });

  return {
    version: 1,
    repository: input.repository,
    baseSha: input.baseSha,
    headSha: input.headSha,
    evidenceState: input.evidenceState ?? "current",
    evidenceDigest: digest,
    manifest: input.manifest,
    decisions: input.decisions,
    approvals: input.approvals,
    checklist: input.checklist,
    createdAt: new Date().toISOString(),
  };
}

export function verifyEvidenceLedger(
  ledgerDoc: EvidenceLedgerDocument,
  fileHashes?: Map<string, string> | Record<string, string>,
): LedgerVerificationResult {
  const tamperedItems: string[] = [];
  const missingItems: string[] = [];
  const errors: string[] = [];

  const hashesMap: Record<string, string> =
    fileHashes instanceof Map ? Object.fromEntries(fileHashes.entries()) : (fileHashes ?? {});

  // 1. Verify Manifest files checksums if fileHashes provided
  let manifestCheckPassed = true;
  if (Object.keys(hashesMap).length > 0) {
    for (const item of ledgerDoc.manifest) {
      const actualHash = hashesMap[item.path] ?? hashesMap[item.name];
      if (!actualHash) {
        missingItems.push(item.path);
        manifestCheckPassed = false;
      } else if (actualHash.toLowerCase() !== item.sha256.toLowerCase()) {
        tamperedItems.push(`${item.path} (expected ${item.sha256.slice(0, 8)}..., got ${actualHash.slice(0, 8)}...)`);
        manifestCheckPassed = false;
      }
    }
  }

  // 2. Recalculate Composite Digest
  const calculatedDigest = calculateEvidenceDigest({
    manifest: ledgerDoc.manifest,
    decisions: ledgerDoc.decisions,
    approvals: ledgerDoc.approvals,
    checklist: ledgerDoc.checklist,
  });

  if (calculatedDigest !== ledgerDoc.evidenceDigest) {
    errors.push(
      `Evidence digest mismatch: calculated ${calculatedDigest.slice(0, 12)}... but document specifies ${ledgerDoc.evidenceDigest.slice(0, 12)}...`,
    );
  }

  // 3. Validate decision reasons
  for (const d of ledgerDoc.decisions) {
    if (d.disposition === "accepted_risk" && d.reason.trim().length < 20) {
      errors.push(`Invalid decision on ${d.fingerprint.slice(0, 8)}: accepted_risk requires min 20 char reason.`);
    }
  }

  const verified = manifestCheckPassed && calculatedDigest === ledgerDoc.evidenceDigest && errors.length === 0;

  return {
    verified,
    calculatedDigest,
    expectedDigest: ledgerDoc.evidenceDigest,
    manifestCheckPassed,
    tamperedItems,
    missingItems,
    errors,
  };
}
