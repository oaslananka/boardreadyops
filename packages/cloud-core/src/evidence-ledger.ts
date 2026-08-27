import { createHash } from "node:crypto";
import type {
  EvidenceItem,
  EvidenceLedgerDocument,
  LedgerApprovalRecord,
  LedgerChecklistRecord,
  LedgerDecisionRecord,
  LedgerVerificationResult,
} from "@boardreadyops/contracts";

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(",")}]`;
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJsonStringify(val)}`;
  });
  return `{${pairs.join(",")}}`;
}

export function computeCanonicalHash(obj: unknown): string {
  const canonical = canonicalJsonStringify(obj);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function calculateEvidenceDigest(params: {
  manifest: EvidenceItem[];
  decisions: LedgerDecisionRecord[];
  approvals: LedgerApprovalRecord[];
  checklist: LedgerChecklistRecord[];
}): string {
  const sortedManifest = [...params.manifest].sort((a, b) => a.path.localeCompare(b.path));
  const sortedDecisions = [...params.decisions].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const sortedApprovals = [...params.approvals].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const sortedChecklist = [...params.checklist].sort((a, b) => a.id.localeCompare(b.id));

  const composite = {
    manifest: sortedManifest.map((m) => ({
      name: m.name,
      path: m.path,
      type: m.type,
      sizeBytes: m.sizeBytes,
      sha256: m.sha256,
    })),
    decisions: sortedDecisions.map((d) => ({
      fingerprint: d.fingerprint,
      disposition: d.disposition,
      reason: d.reason,
      owner: d.owner,
      expiresAt: d.expiresAt ?? null,
      timestamp: d.timestamp,
    })),
    approvals: sortedApprovals.map((a) => ({
      approverId: a.approverId,
      status: a.status,
      reason: a.reason ?? "",
      isBreakGlass: a.isBreakGlass ?? false,
      timestamp: a.timestamp,
    })),
    checklist: sortedChecklist.map((c) => ({
      id: c.id,
      title: c.title,
      completed: c.completed,
      completedBy: c.completedBy ?? "",
      completedAt: c.completedAt ?? "",
    })),
  };

  return computeCanonicalHash(composite);
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
