import { z } from "zod";

export const policySeverityGateSchema = z.enum(["error", "high", "medium"]);
export type PolicySeverityGate = z.infer<typeof policySeverityGateSchema>;

export const reviewPolicySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  scope: z.enum(["organization", "team", "repository"]),
  scopeId: z.string().min(1).nullable(),
  name: z.string().min(1).max(128),
  description: z.string().max(1000).optional(),
  requiredChecklist: z.array(z.string().min(1).max(128)).default([]),
  requiredRoles: z.array(z.string().min(1).max(64)).default([]),
  severityGate: policySeverityGateSchema.optional(),
  requireEvidencePack: z.boolean().default(false),
  requireExternalReview: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReviewPolicy = z.infer<typeof reviewPolicySchema>;

export const createPolicyInputSchema = z.object({
  scope: z.enum(["organization", "team", "repository"]),
  scopeId: z.string().min(1).optional(),
  name: z.string().min(1).max(128),
  description: z.string().max(1000).optional(),
  requiredChecklist: z.array(z.string().min(1).max(128)).max(20).default([]),
  requiredRoles: z.array(z.string().min(1).max(64)).max(10).default([]),
  severityGate: policySeverityGateSchema.optional(),
  requireEvidencePack: z.boolean().default(false),
  requireExternalReview: z.boolean().default(false),
});
export type CreatePolicyInput = z.infer<typeof createPolicyInputSchema>;

export const policySourceLayerSchema = z.enum(["organization", "team", "repository", "exception"]);
export type PolicySourceLayer = z.infer<typeof policySourceLayerSchema>;

export const policyFieldSourceSchema = z.object({
  layer: policySourceLayerSchema,
  policyId: z.string().min(1),
  policyName: z.string().min(1),
});
export type PolicyFieldSource = z.infer<typeof policyFieldSourceSchema>;

export const effectivePolicyProvenanceSchema = z.object({
  requiredChecklist: policyFieldSourceSchema.nullable(),
  requiredRoles: policyFieldSourceSchema.nullable(),
  severityGate: policyFieldSourceSchema.nullable(),
  requireEvidencePack: policyFieldSourceSchema.nullable(),
  requireExternalReview: policyFieldSourceSchema.nullable(),
});
export type EffectivePolicyProvenance = z.infer<typeof effectivePolicyProvenanceSchema>;

export const effectivePolicySchema = z.object({
  policy: reviewPolicySchema,
  sourceLayer: policySourceLayerSchema,
  inheritedFrom: z.string().min(1).nullable(),
  provenance: effectivePolicyProvenanceSchema.optional(),
});
export type EffectivePolicy = z.infer<typeof effectivePolicySchema>;

export const policyDryRunResultSchema = z.object({
  affectedRepositories: z.number().int().nonnegative(),
  affectedReviews: z.number().int().nonnegative(),
  blockersIntroduced: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});
export type PolicyDryRunResult = z.infer<typeof policyDryRunResultSchema>;
