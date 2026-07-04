import { z } from "zod";

export const releaseRunStatusSchema = z.enum(["queued", "running", "completed", "timed_out", "failed"]);
export const releaseDecisionSchema = z.enum(["pass", "fail", "error"]);
export const triggerKindSchema = z.enum(["push", "pr", "manual", "workflow_dispatch"]);
export const findingSeveritySchema = z.enum(["error", "high", "medium", "low", "info"]);

export const createReleaseRunRequestSchema = z.object({
  repositoryId: z.string().min(1),
  commitSha: z.string().min(7).max(64),
  ref: z.string().min(1),
  pullRequestNumber: z.number().int().positive().optional(),
  triggerKind: triggerKindSchema,
});

export const findingSchema = z.object({
  ruleId: z.string().min(1),
  severity: findingSeveritySchema,
  message: z.string().min(1),
  path: z.string().optional(),
});

export const releaseRunResultSchema = z.object({
  status: releaseRunStatusSchema,
  decision: releaseDecisionSchema.nullable(),
  findings: z.array(findingSchema).default([]),
});

export type CreateReleaseRunRequest = z.infer<typeof createReleaseRunRequestSchema>;
export type ReleaseRunResult = z.infer<typeof releaseRunResultSchema>;
