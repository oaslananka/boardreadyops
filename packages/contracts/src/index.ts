import { z } from "zod";
import { artifactContentTypeSchema, runnerLeaseContextSchema } from "./runner-protocol.js";

export * from "./evidence-ledger.js";
export * from "./external-review.js";
export * from "./review.js";
export * from "./runner-protocol.js";
export * from "./snapshots.js";

export const releaseRunStatusSchema = z.enum(["queued", "running", "completed", "timed_out", "failed"]);
export const releaseDecisionSchema = z.enum(["pass", "fail", "error"]);
export const releaseRunConclusionSchema = z.enum(["success", "failure", "neutral", "timed_out"]);
export const triggerKindSchema = z.enum(["push", "pr", "manual", "workflow_dispatch"]);
export const findingSeveritySchema = z.enum(["error", "high", "medium", "low", "info"]);

/**
 * A finding's stable identity, matching the local `Finding.fingerprint` format
 * (`crypto.createHash("sha256").digest("hex")` in `src/core/findings.ts`).
 *
 * Optional on the wire: an older CLI/Action sends findings without it, and cloud must
 * accept those. Present, it lets a finding be tracked across two runs of the same
 * review instead of only appearing in aggregate before/after counts.
 */
export const findingFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);

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
  project: z.string().trim().min(1).max(1024).optional(),
  fingerprint: findingFingerprintSchema.optional(),
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
  contentType: artifactContentTypeSchema.optional(),
});

export const releaseRunBomComponentSchema = z
  .object({
    reference: z.string().trim().min(1).max(64),
    mpn: z.string().trim().min(1).max(128).optional(),
    manufacturer: z.string().trim().min(1).max(128).optional(),
    value: z.string().trim().min(1).max(256).optional(),
    footprint: z.string().trim().min(1).max(256).optional(),
    quantity: z.number().int().positive().max(1_000_000).optional(),
    dnp: z.boolean().optional(),
    lifecycle: z.string().trim().min(1).max(64).optional(),
    identityKey: z
      .string()
      .regex(/^[0-9a-f]{16}$/u)
      .optional(),
  })
  .strict();

export const releaseRunBoardBomSchema = z
  .object({
    project: z.string().trim().min(1).max(1024),
    components: z.array(releaseRunBomComponentSchema).max(5000),
  })
  .strict();

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

export const releaseRunReadinessSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    status: z.enum(["ready", "at-risk", "blocked"]),
    blocking: z.number().int().nonnegative().max(10_000),
    nonBlocking: z.number().int().nonnegative().max(10_000),
    missingRequired: z.array(z.string().trim().min(1).max(256)).max(100).default([]),
    missingRecommended: z.array(z.string().trim().min(1).max(256)).max(100).default([]),
    warnings: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  })
  .strict();

export const releaseRunWaiverSchema = z
  .object({
    rule: z.string().trim().min(1).max(256),
    owner: z.string().trim().min(1).max(256),
    reason: z.string().trim().min(1).max(2000),
    expires: z.iso.date().optional(),
    approvedBy: z.string().trim().min(1).max(256).optional(),
    evidence: z.string().trim().min(1).max(2048).optional(),
    stale: z.boolean(),
    expired: z.boolean(),
    matched: z.number().int().nonnegative().max(10_000),
  })
  .strict();

export const releaseRunWaiversSchema = z
  .object({
    active: z.array(releaseRunWaiverSchema).max(100).default([]),
    expired: z.array(releaseRunWaiverSchema).max(100).default([]),
  })
  .strict();

export const hardwareImpactDomainSchema = z.enum(["readiness", "findings", "bom", "manufacturing"]);
export const hardwareImpactRiskDirectionSchema = z.enum(["increased", "decreased", "unchanged", "unknown"]);
export const hardwareImpactBaselineReasonSchema = z.enum([
  "not-found",
  "invalid-artifact",
  "unsupported-result",
  "candidate-mismatch",
]);
const hardwareImpactShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const hardwareImpactCountSchema = z.number().int().nonnegative().max(10_000);
const hardwareImpactReadinessStatusSchema = z.enum(["ready", "at-risk", "blocked"]);
const hardwareImpactEvidenceSeveritySchema = z.enum(["critical", "error", "high", "medium", "low", "info"]);

const hardwareImpactAvailableBaselineSchema = z
  .object({ status: z.literal("available"), sha: hardwareImpactShaSchema })
  .strict();
const hardwareImpactUnavailableBaselineSchema = z
  .object({
    status: z.literal("unavailable"),
    sha: hardwareImpactShaSchema,
    reason: hardwareImpactBaselineReasonSchema,
  })
  .strict();

export const hardwareImpactEvidenceRefSchema = z
  .object({
    domain: hardwareImpactDomainSchema,
    kind: z.enum(["finding", "bom-row", "output", "readiness"]),
    label: z.string().trim().min(1).max(256),
    path: z.string().trim().min(1).max(256).optional(),
    ruleId: z.string().trim().min(1).max(256).optional(),
    severity: hardwareImpactEvidenceSeveritySchema.optional(),
    fingerprint: findingFingerprintSchema.optional(),
  })
  .strict();

export const hardwareImpactV1Schema = z
  .object({
    version: z.literal(1),
    baseline: z.discriminatedUnion("status", [
      hardwareImpactAvailableBaselineSchema,
      hardwareImpactUnavailableBaselineSchema,
    ]),
    candidate: z.object({ sha: hardwareImpactShaSchema }).strict(),
    facts: z
      .object({
        readiness: z
          .object({
            previousScore: z.number().int().min(0).max(100).nullable(),
            currentScore: z.number().int().min(0).max(100).nullable(),
            scoreDelta: z.number().int().min(-100).max(100).nullable(),
            previousStatus: hardwareImpactReadinessStatusSchema.nullable(),
            currentStatus: hardwareImpactReadinessStatusSchema.nullable(),
            statusChanged: z.boolean(),
          })
          .strict(),
        findings: z
          .object({
            added: hardwareImpactCountSchema,
            resolved: hardwareImpactCountSchema,
            addedBlocking: hardwareImpactCountSchema,
            resolvedBlocking: hardwareImpactCountSchema,
          })
          .strict(),
        bom: z
          .object({
            added: hardwareImpactCountSchema,
            removed: hardwareImpactCountSchema,
            changed: hardwareImpactCountSchema,
            truncated: z.boolean(),
          })
          .strict(),
        manufacturing: z
          .object({
            outputsAdded: hardwareImpactCountSchema,
            outputsRemoved: hardwareImpactCountSchema,
            outputsChanged: hardwareImpactCountSchema,
          })
          .strict(),
      })
      .strict(),
    assessment: z
      .object({
        materialChange: z.boolean(),
        riskDirection: hardwareImpactRiskDirectionSchema,
        affectedDomains: z
          .array(hardwareImpactDomainSchema)
          .max(4)
          .refine((domains) => new Set(domains).size === domains.length, "affected domains must be unique"),
      })
      .strict(),
    evidence: z.array(hardwareImpactEvidenceRefSchema).max(12),
  })
  .strict();

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
    readiness: releaseRunReadinessSchema.optional(),
    waivers: releaseRunWaiversSchema.optional(),
    hardwareImpact: hardwareImpactV1Schema.optional(),
    // Optional with no default: a default would materialise the key on every legacy
    // payload and change its terminal-result digest, breaking replay detection.
    boms: z.array(releaseRunBoardBomSchema).max(50).optional(),
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

export const runnerTerminalResultRequestSchema = runnerLeaseContextSchema
  .extend({
    result: releaseRunResultSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.result.executionAttemptId !== value.executionAttemptId) {
      context.addIssue({
        code: "custom",
        path: ["result", "executionAttemptId"],
        message: "terminal result must be bound to the leased execution attempt",
      });
    }
  });

export type CreateReleaseRunRequest = z.infer<typeof createReleaseRunRequestSchema>;
export type ReleaseRunBomComponent = z.infer<typeof releaseRunBomComponentSchema>;
export type ReleaseRunBoardBom = z.infer<typeof releaseRunBoardBomSchema>;
export type ReleaseRunResult = z.infer<typeof releaseRunResultSchema>;
export type RunnerTerminalResultRequest = z.infer<typeof runnerTerminalResultRequestSchema>;
