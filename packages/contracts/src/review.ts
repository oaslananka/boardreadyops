import { z } from "zod";

export const findingDiffStates = ["new", "persistent", "regressed", "resolved"] as const;
export const findingDiffStateSchema = z.enum(findingDiffStates);
export type FindingDiffState = z.infer<typeof findingDiffStateSchema>;

export const findingDispositions = ["open", "fixed", "accepted_risk", "false_positive", "not_applicable"] as const;
export const findingDispositionSchema = z.enum(findingDispositions);
export type FindingDisposition = z.infer<typeof findingDispositionSchema>;

export const evidenceStates = ["current", "stale", "unavailable", "incomplete"] as const;
export const evidenceStateSchema = z.enum(evidenceStates);
export type EvidenceState = z.infer<typeof evidenceStateSchema>;

export const reviewDecisions = ["pending", "approved", "changes_requested"] as const;
export const reviewDecisionSchema = z.enum(reviewDecisions);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const reviewStatuses = ["draft", "active", "awaiting_decision", "completed", "superseded"] as const;
export const reviewStatusSchema = z.enum(reviewStatuses);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const uploadModes = ["metadata", "snapshots", "source"] as const;
export const uploadModeSchema = z.enum(uploadModes);
export type UploadMode = z.infer<typeof uploadModeSchema>;

export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "must be a 64-character lowercase SHA-256 hex digest");
export const commitShaSchema = z.string().min(7).max(64);

export const reviewSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().min(1),
  pullRequestNumber: z.number().int().positive().optional(),
  title: z.string().min(1).max(256),
  status: reviewStatusSchema,
  decision: reviewDecisionSchema,
  baseRunId: z.string().uuid().optional(),
  headRunId: z.string().uuid(),
  currentRevisionId: z.string().uuid(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewRevisionSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  sequence: z.number().int().positive(),
  baseRunId: z.string().uuid().optional(),
  headRunId: z.string().uuid(),
  baseCommitSha: commitShaSchema.optional(),
  headCommitSha: commitShaSchema,
  evidenceDigest: sha256HexSchema,
  createdAt: z.string().datetime(),
});
export type ReviewRevision = z.infer<typeof reviewRevisionSchema>;

export const findingDecisionSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  findingFingerprint: sha256HexSchema,
  disposition: findingDispositionSchema,
  reason: z.string().min(1).max(4000),
  actorId: z.string().min(1),
  evidenceDigest: sha256HexSchema,
  expiresAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type FindingDecision = z.infer<typeof findingDecisionSchema>;

export const createFindingDecisionRequestSchema = z
  .object({
    disposition: findingDispositionSchema,
    reason: z.string().min(1).max(4000),
    expiresAt: z.string().datetime().optional(),
    evidenceDigest: sha256HexSchema,
  })
  .superRefine((data, ctx) => {
    if (data.disposition === "accepted_risk") {
      if (data.reason.trim().length < 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Accepted risk disposition requires a detailed reason of at least 20 characters",
          path: ["reason"],
        });
      }
    }
  });
export type CreateFindingDecisionRequest = z.infer<typeof createFindingDecisionRequestSchema>;

export const findingAssignmentSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  findingFingerprint: sha256HexSchema,
  assigneeId: z.string().min(1),
  assignedBy: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type FindingAssignment = z.infer<typeof findingAssignmentSchema>;

export const reviewCommentSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  findingFingerprint: sha256HexSchema.optional(),
  parentCommentId: z.string().uuid().optional(),
  body: z.string().min(1).max(10_000),
  authorId: z.string().min(1),
  evidenceDigest: sha256HexSchema,
  state: z.enum(["open", "resolved", "stale"]),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const createReviewCommentRequestSchema = z.object({
  findingFingerprint: sha256HexSchema.optional(),
  parentCommentId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(10_000),
  evidenceDigest: sha256HexSchema,
});
export type CreateReviewCommentRequest = z.infer<typeof createReviewCommentRequestSchema>;

export const reviewApprovalSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  revisionId: z.string().uuid(),
  reviewerId: z.string().min(1),
  decision: z.enum(["approved", "changes_requested"]),
  evidenceDigest: sha256HexSchema,
  createdAt: z.string().datetime(),
  invalidatedAt: z.string().datetime().optional(),
  invalidationReason: z.string().max(1000).optional(),
});
export type ReviewApproval = z.infer<typeof reviewApprovalSchema>;

export const createReviewApprovalRequestSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  evidenceDigest: sha256HexSchema,
  reason: z.string().max(1000).optional(),
});
export type CreateReviewApprovalRequest = z.infer<typeof createReviewApprovalRequestSchema>;

export const uploadManifestItemSchema = z.object({
  kind: z.string().min(1).max(64),
  path: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(128),
  bytes: z.number().int().nonnegative().max(1_073_741_824), // 1GB limit per item
  sha256: sha256HexSchema,
  dataClass: z.enum(["metadata", "snapshot", "source"]),
});
export type UploadManifestItem = z.infer<typeof uploadManifestItemSchema>;

export const uploadManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    uploadMode: uploadModeSchema,
    repositoryId: z.string().min(1),
    commitSha: commitShaSchema,
    toolVersion: z.string().min(1),
    configDigest: sha256HexSchema,
    rulePackDigest: sha256HexSchema,
    items: z.array(uploadManifestItemSchema).max(5000),
  })
  .superRefine((data, ctx) => {
    const hasSource = data.items.some((item) => item.dataClass === "source");
    if (hasSource && data.uploadMode !== "source") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Manifest containing source files requires explicit uploadMode 'source'",
        path: ["uploadMode"],
      });
    }
  });
export type UploadManifest = z.infer<typeof uploadManifestSchema>;

export const visualSnapshotSchema = z.object({
  id: z.string().uuid(),
  reviewRevisionId: z.string().uuid(),
  artifactId: z.string().uuid(),
  pageOrLayer: z.string().min(1).max(256),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: sha256HexSchema,
  anchorMapSha256: sha256HexSchema,
});
export type VisualSnapshot = z.infer<typeof visualSnapshotSchema>;

export const externalReviewLinkSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  tokenDigest: sha256HexSchema,
  createdBy: z.string().min(1),
  allowComments: z.boolean(),
  allowApprovals: z.boolean(),
  allowSnapshots: z.boolean(),
  allowSourceDownload: z.boolean(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  lastUsedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type ExternalReviewLink = z.infer<typeof externalReviewLinkSchema>;

export const createExternalReviewLinkRequestSchema = z.object({
  allowComments: z.boolean().default(true),
  allowApprovals: z.boolean().default(false),
  allowSnapshots: z.boolean().default(true),
  allowSourceDownload: z.boolean().default(false),
  durationDays: z.number().int().min(1).max(30).default(7),
});
export type CreateExternalReviewLinkRequest = z.infer<typeof createExternalReviewLinkRequestSchema>;

export const reviewFindingDiffItemSchema = z.object({
  fingerprint: sha256HexSchema,
  ruleId: z.string().min(1),
  severity: z.enum(["error", "high", "medium", "low", "info"]),
  message: z.string(),
  path: z.string().optional(),
  project: z.string().optional(),
  diffState: findingDiffStateSchema,
  currentDisposition: findingDispositionSchema,
  activeDecision: findingDecisionSchema.optional(),
  assignment: findingAssignmentSchema.optional(),
  commentCount: z.number().int().nonnegative(),
});
export type ReviewFindingDiffItem = z.infer<typeof reviewFindingDiffItemSchema>;
