import { z } from "zod";

export const releaseRunStatusSchema = z.enum(["queued", "running", "completed", "timed_out", "failed"]);
export const releaseDecisionSchema = z.enum(["pass", "fail", "error"]);
export const releaseRunConclusionSchema = z.enum(["success", "failure", "neutral", "timed_out"]);
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
  ruleId: z.string().min(1).max(256),
  severity: findingSeveritySchema,
  message: z.string().min(1).max(4000),
  path: z.string().min(1).max(1024).optional(),
});

const artifactStoragePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
    "artifact storagePath must be a relative path within the configured artifact root",
  );

export const releaseRunArtifactSchema = z.object({
  kind: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  storagePath: artifactStoragePathSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().nonnegative().max(2_147_483_647),
  role: z.string().trim().min(1).max(128),
});

export const releaseRunReportLinkSchema = z.object({
  label: z.string().trim().min(1).max(160),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((value) => new URL(value).protocol === "https:", "report link must use HTTPS"),
});

export const releaseRunMetricsSchema = z
  .record(z.string().trim().min(1).max(128), z.number().finite())
  .refine((value) => Object.keys(value).length <= 100, "metrics must contain at most 100 entries");

function inferredConclusion(input: {
  status: z.infer<typeof releaseRunStatusSchema>;
  decision: z.infer<typeof releaseDecisionSchema> | null;
}): z.infer<typeof releaseRunConclusionSchema> {
  if (input.status === "timed_out") {
    return "timed_out";
  }
  if (input.status === "completed" && input.decision === "pass") {
    return "success";
  }
  if (input.status === "failed" || input.decision === "fail" || input.decision === "error") {
    return "failure";
  }
  return "neutral";
}

const releaseRunResultBaseSchema = z
  .object({
    version: z.literal(1).default(1),
    executionAttemptId: z.string().uuid().optional(),
    status: releaseRunStatusSchema,
    conclusion: releaseRunConclusionSchema.optional(),
    decision: releaseDecisionSchema.nullable(),
    findings: z.array(findingSchema).max(500).default([]),
    artifacts: z.array(releaseRunArtifactSchema).max(100).default([]),
    metrics: releaseRunMetricsSchema.default({}),
    reportLinks: z.array(releaseRunReportLinkSchema).max(20).default([]),
  })
  .strict();

export const releaseRunResultSchema = releaseRunResultBaseSchema
  .superRefine((value, context) => {
    const expected = inferredConclusion(value);
    if (value.conclusion !== undefined && value.conclusion !== expected) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: `conclusion must be ${expected} for the supplied status and decision`,
      });
    }
  })
  .transform((value) => ({
    ...value,
    conclusion: value.conclusion ?? inferredConclusion(value),
  }));

export type CreateReleaseRunRequest = z.infer<typeof createReleaseRunRequestSchema>;
export type ReleaseRunResult = z.infer<typeof releaseRunResultSchema>;
