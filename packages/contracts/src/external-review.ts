import { z } from "zod";

export const externalReviewScopeSchema = z.enum(["read_only", "comment_only", "approve_only"]);
export type ExternalReviewScope = z.infer<typeof externalReviewScopeSchema>;

export const externalReviewInvitationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  reviewId: z.string().min(1),
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1),
  scope: externalReviewScopeSchema,
  tokenHash: z.string().min(64).max(64),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
  createdById: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ExternalReviewInvitation = z.infer<typeof externalReviewInvitationSchema>;

export const createExternalReviewRequestSchema = z.object({
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1),
  scope: externalReviewScopeSchema,
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export type CreateExternalReviewRequest = z.infer<typeof createExternalReviewRequestSchema>;
