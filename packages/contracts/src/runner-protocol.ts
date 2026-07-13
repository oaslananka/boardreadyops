import { z } from "zod";

const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const capabilityPattern = /^[a-z0-9][a-z0-9._:-]*$/u;
const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const githubRepositoryPattern = /^[A-Za-z0-9_.-]{1,100}$/u;

export const runnerProtocolVersionSchema = z.literal(1);
export const runnerWorkerClassSchema = z.enum(["managed", "self_hosted"]);
export const runnerSigningAlgorithmSchema = z.literal("ed25519");
export const runnerIdentifierSchema = z.string().regex(lowercaseUuidPattern, "identifier must be a lowercase UUID");
export const runnerRequestTimestampSchema = z.number().int().nonnegative().max(9_999_999_999);
export const runnerRequestNonceSchema = z.string().min(22).max(128).regex(base64UrlPattern);
export const runnerRequestSignatureSchema = z.string().length(86).regex(base64UrlPattern);
export const runnerLeaseSecretSchema = z.string().min(43).max(256).regex(base64UrlPattern);
export const runnerEnrollmentTokenSchema = z.string().min(43).max(256).regex(base64UrlPattern);
export const runnerCapabilitySchema = z.string().trim().min(1).max(128).regex(capabilityPattern);
export const runnerSafeModeReasonSchema = z.enum(["draft-pull-request", "fork-pull-request", "private-repository"]);

export const runnerSignedRequestEnvelopeSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    algorithm: runnerSigningAlgorithmSchema,
    workerClass: runnerWorkerClassSchema,
    runnerId: runnerIdentifierSchema,
    timestamp: runnerRequestTimestampSchema,
    nonce: runnerRequestNonceSchema,
    signature: runnerRequestSignatureSchema,
  })
  .strict();

export const runnerClaimRequestSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    workerClass: runnerWorkerClassSchema,
    capabilities: z.array(runnerCapabilitySchema).max(64).default([]),
    labels: z.array(runnerCapabilitySchema).max(32).default([]),
  })
  .strict();

export const runnerRepositoryDescriptorSchema = z
  .object({
    owner: z.string().regex(githubOwnerPattern),
    name: z.string().regex(githubRepositoryPattern),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/u),
    private: z.boolean(),
  })
  .strict();

export const runnerSafeModeSchema = z
  .object({
    enabled: z.boolean(),
    reasons: z.array(runnerSafeModeReasonSchema).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && value.reasons.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "safe mode requires at least one reason",
      });
    }
    if (!value.enabled && value.reasons.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "safe-mode reasons require safe mode to be enabled",
      });
    }
  });

export const runnerClaimedJobSchema = z
  .object({
    leaseId: runnerIdentifierSchema,
    leaseToken: runnerLeaseSecretSchema,
    runId: runnerIdentifierSchema,
    executionAttemptId: runnerIdentifierSchema,
    leaseExpiresAt: z.string().datetime({ offset: true }),
    maximumLeaseExpiresAt: z.string().datetime({ offset: true }),
    sourceMode: z.enum(["broker", "customer_checkout"]),
    repository: runnerRepositoryDescriptorSchema,
    safeMode: runnerSafeModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.leaseExpiresAt) > Date.parse(value.maximumLeaseExpiresAt)) {
      context.addIssue({
        code: "custom",
        path: ["leaseExpiresAt"],
        message: "lease expiry cannot exceed the maximum lease expiry",
      });
    }
    if (value.sourceMode === "broker" && value.safeMode.reasons.includes("fork-pull-request")) {
      context.addIssue({
        code: "custom",
        path: ["sourceMode"],
        message: "broker source mode cannot be assigned to fork pull requests",
      });
    }
  });

export const runnerClaimResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      protocolVersion: runnerProtocolVersionSchema,
      status: z.literal("empty"),
      retryAfterSeconds: z.number().int().min(1).max(300),
    })
    .strict(),
  z
    .object({
      protocolVersion: runnerProtocolVersionSchema,
      status: z.literal("claimed"),
      job: runnerClaimedJobSchema,
    })
    .strict(),
]);

export const runnerLeaseContextSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    runId: runnerIdentifierSchema,
    executionAttemptId: runnerIdentifierSchema,
    leaseId: runnerIdentifierSchema,
    leaseToken: runnerLeaseSecretSchema,
  })
  .strict();

export const runnerLeaseStageSchema = z.enum([
  "claimed",
  "preparing_source",
  "running",
  "uploading_artifacts",
  "reporting",
]);

export const runnerLeaseHeartbeatRequestSchema = runnerLeaseContextSchema
  .extend({
    stage: runnerLeaseStageSchema,
    progressPercent: z.number().int().min(0).max(100).optional(),
    message: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const runnerLeaseHeartbeatResponseSchema = z.union([
  z
    .object({
      protocolVersion: runnerProtocolVersionSchema,
      status: z.literal("active"),
      leaseExpiresAt: z.string().datetime({ offset: true }),
      maximumLeaseExpiresAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      protocolVersion: runnerProtocolVersionSchema,
      status: z.enum(["expired", "revoked", "completed", "stale"]),
    })
    .strict(),
]);

export const runnerLeaseRelinquishRequestSchema = runnerLeaseContextSchema
  .extend({
    reason: z.enum(["shutdown", "capacity", "operator", "job_error"]),
    message: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const runnerArtifactDeclarationSchema = z
  .object({
    kind: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(256),
    role: z.string().trim().min(1).max(128),
    bytes: z.number().int().nonnegative().max(2_147_483_647),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
  })
  .strict();

export const runnerArtifactCapabilityRequestSchema = runnerLeaseContextSchema
  .extend({
    artifacts: z.array(runnerArtifactDeclarationSchema).min(1).max(100),
  })
  .strict();

export const runnerArtifactUploadCapabilitySchema = z
  .object({
    artifactId: runnerIdentifierSchema,
    uploadUrl: z
      .string()
      .url()
      .max(4096)
      .refine((value) => new URL(value).protocol === "https:", "upload URL must use HTTPS"),
    expiresAt: z.string().datetime({ offset: true }),
    maximumBytes: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strict();

export const runnerArtifactCapabilityResponseSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    uploads: z.array(runnerArtifactUploadCapabilitySchema).min(1).max(100),
  })
  .strict();

export const runnerRegistrationActivationRequestSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    enrollmentToken: runnerEnrollmentTokenSchema,
    algorithm: runnerSigningAlgorithmSchema,
    publicKey: z.string().trim().min(32).max(16_384),
    capabilities: z.array(runnerCapabilitySchema).max(64).default([]),
  })
  .strict();

export const runnerRegistrationActivationResponseSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    status: z.enum(["activated", "replayed"]),
    registrationId: runnerIdentifierSchema,
  })
  .strict();

export const runnerMutationResponseSchema = z
  .object({
    protocolVersion: runnerProtocolVersionSchema,
    status: z.enum(["accepted", "replayed"]),
  })
  .strict();

export type RunnerWorkerClass = z.infer<typeof runnerWorkerClassSchema>;
export type RunnerSignedRequestEnvelope = z.infer<typeof runnerSignedRequestEnvelopeSchema>;
export type RunnerClaimRequest = z.infer<typeof runnerClaimRequestSchema>;
export type RunnerClaimResponse = z.infer<typeof runnerClaimResponseSchema>;
export type RunnerLeaseContext = z.infer<typeof runnerLeaseContextSchema>;
export type RunnerLeaseHeartbeatRequest = z.infer<typeof runnerLeaseHeartbeatRequestSchema>;
export type RunnerLeaseRelinquishRequest = z.infer<typeof runnerLeaseRelinquishRequestSchema>;
export type RunnerArtifactCapabilityRequest = z.infer<typeof runnerArtifactCapabilityRequestSchema>;
export type RunnerArtifactCapabilityResponse = z.infer<typeof runnerArtifactCapabilityResponseSchema>;
export type RunnerRegistrationActivationRequest = z.infer<typeof runnerRegistrationActivationRequestSchema>;
export type RunnerRegistrationActivationResponse = z.infer<typeof runnerRegistrationActivationResponseSchema>;
