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
