import { createHash } from "node:crypto";
import { z } from "zod";
import { findingDispositionSchema } from "./review.js";

export const evidenceItemSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().min(64).max(64),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const ledgerDecisionRecordSchema = z.object({
  fingerprint: z.string().min(64).max(64),
  disposition: findingDispositionSchema,
  reason: z.string().min(1),
  owner: z.string().min(1),
  expiresAt: z.string().nullable().optional(),
  timestamp: z.string().datetime(),
});
export type LedgerDecisionRecord = z.infer<typeof ledgerDecisionRecordSchema>;

export const ledgerApprovalRecordSchema = z.object({
  approverId: z.string().min(1),
  status: z.enum(["approved", "changes_requested"]),
  reason: z.string().optional(),
  isBreakGlass: z.boolean().default(false),
  timestamp: z.string().datetime(),
});
export type LedgerApprovalRecord = z.infer<typeof ledgerApprovalRecordSchema>;

export const ledgerChecklistRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  completed: z.boolean(),
  completedBy: z.string().optional(),
  completedAt: z.string().optional(),
});
export type LedgerChecklistRecord = z.infer<typeof ledgerChecklistRecordSchema>;

export const evidenceLedgerDocumentSchema = z.object({
  version: z.literal(1),
  repository: z.string().min(1),
  baseSha: z.string().min(7).max(64),
  headSha: z.string().min(7).max(64),
  evidenceState: z.enum(["current", "stale", "invalid"]),
  evidenceDigest: z.string().min(64).max(64),
  manifest: z.array(evidenceItemSchema),
  decisions: z.array(ledgerDecisionRecordSchema),
  approvals: z.array(ledgerApprovalRecordSchema),
  checklist: z.array(ledgerChecklistRecordSchema),
  createdAt: z.string().datetime(),
});
export type EvidenceLedgerDocument = z.infer<typeof evidenceLedgerDocumentSchema>;

export const ledgerVerificationResultSchema = z.object({
  verified: z.boolean(),
  calculatedDigest: z.string().min(64).max(64),
  expectedDigest: z.string().min(64).max(64),
  manifestCheckPassed: z.boolean(),
  tamperedItems: z.array(z.string()),
  missingItems: z.array(z.string()),
  errors: z.array(z.string()),
});
export type LedgerVerificationResult = z.infer<typeof ledgerVerificationResultSchema>;

/**
 * Deterministic JSON serialization (object keys sorted) used as the sole basis for evidence
 * digests. Both the CLI (`src/release/evidence.ts`) and the cloud service (`@boardreadyops/cloud-core`)
 * must derive digests from this single implementation so offline verification never drifts from
 * what the cloud recorded.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(",")}]`;
  }

  // Ordinal (code-unit) compare, not localeCompare: this key order feeds a cryptographic
  // digest, and localeCompare's collation can vary across ICU builds/locales — it must stay
  // byte-identical to the default sort() behavior it's replacing, just made explicit.
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJsonStringify(val)}`;
  });
  return `{${pairs.join(",")}}`;
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

  const canonical = canonicalJsonStringify(composite);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
