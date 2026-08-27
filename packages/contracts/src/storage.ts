import { z } from "zod";

export const beginUploadInputSchema = z.object({
  tenantId: z.string().min(1),
  repositoryId: z.string().min(1),
  reviewId: z.string().uuid().optional(),
  key: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(128),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BeginUploadInput = z.infer<typeof beginUploadInputSchema>;

export const uploadCapabilitySchema = z.object({
  uploadId: z.string().min(1),
  key: z.string().min(1),
  url: z.string().url().optional(),
  expiresAt: z.string().datetime(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type UploadCapability = z.infer<typeof uploadCapabilitySchema>;

export const completeUploadInputSchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
});
export type CompleteUploadInput = z.infer<typeof completeUploadInputSchema>;

export const storedArtifactSchema = z.object({
  key: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type StoredArtifact = z.infer<typeof storedArtifactSchema>;

export const downloadInputSchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
});
export type DownloadInput = z.infer<typeof downloadInputSchema>;

export const downloadCapabilitySchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
  contentType: z.string().min(1),
  contentDisposition: z.string().min(1),
});
export type DownloadCapability = z.infer<typeof downloadCapabilitySchema>;

export const deleteObjectInputSchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
});
export type DeleteObjectInput = z.infer<typeof deleteObjectInputSchema>;
