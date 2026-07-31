type CloudPersistenceMode = "postgres" | "memory";

export type CloudRuntimeConfigurationErrorCode =
  | "invalid-persistence-mode"
  | "memory-persistence-not-allowed"
  | "missing-database-url"
  | "invalid-webhook-retention-days"
  | "invalid-ephemeral-record-retention-days"
  | "invalid-artifact-capability-ttl-seconds";

export class CloudRuntimeConfigurationError extends Error {
  readonly code: CloudRuntimeConfigurationErrorCode;

  constructor(code: CloudRuntimeConfigurationErrorCode, message: string) {
    super(message);
    this.name = "CloudRuntimeConfigurationError";
    this.code = code;
  }
}

export type CloudPersistenceConfiguration = { mode: "postgres"; databaseUrl: string } | { mode: "memory" };

export function resolveCloudPersistenceConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CloudPersistenceConfiguration {
  const configuredMode = environment.BOARDREADYOPS_PERSISTENCE_MODE?.trim();

  if (configuredMode && configuredMode !== "postgres" && configuredMode !== "memory") {
    throw new CloudRuntimeConfigurationError(
      "invalid-persistence-mode",
      "BOARDREADYOPS_PERSISTENCE_MODE must be postgres or memory",
    );
  }

  const mode: CloudPersistenceMode = configuredMode === "memory" ? "memory" : "postgres";

  if (mode === "memory") {
    if (environment.NODE_ENV !== "test" && environment.NODE_ENV !== "development") {
      throw new CloudRuntimeConfigurationError(
        "memory-persistence-not-allowed",
        "memory persistence is allowed only in test or development environments",
      );
    }

    return { mode };
  }

  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new CloudRuntimeConfigurationError("missing-database-url", "DATABASE_URL is required");
  }

  return { mode, databaseUrl };
}

export type ControlPlaneRetentionConfiguration = { webhookInboxDays: number; ephemeralRecordsDays: number };

type RetentionConfigurationErrorCode = "invalid-webhook-retention-days" | "invalid-ephemeral-record-retention-days";

function resolveRetentionDays(input: {
  raw: string | undefined;
  environmentName: string;
  errorCode: RetentionConfigurationErrorCode;
}): number {
  if (input.raw === undefined) return 30;
  const normalized = input.raw.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new CloudRuntimeConfigurationError(
      input.errorCode,
      `${input.environmentName} must be an integer between 1 and 3650`,
    );
  }
  const days = Number(normalized);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new CloudRuntimeConfigurationError(
      input.errorCode,
      `${input.environmentName} must be an integer between 1 and 3650`,
    );
  }
  return days;
}

export function resolveControlPlaneRetentionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ControlPlaneRetentionConfiguration {
  return {
    webhookInboxDays: resolveRetentionDays({
      raw: environment.BOARDREADYOPS_WEBHOOK_RETENTION_DAYS,
      environmentName: "BOARDREADYOPS_WEBHOOK_RETENTION_DAYS",
      errorCode: "invalid-webhook-retention-days",
    }),
    ephemeralRecordsDays: resolveRetentionDays({
      raw: environment.BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS,
      environmentName: "BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS",
      errorCode: "invalid-ephemeral-record-retention-days",
    }),
  };
}

export type ArtifactCapabilityConfiguration = { uploadCapabilityTtlSeconds: number };

export function resolveArtifactCapabilityConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ArtifactCapabilityConfiguration {
  const raw = environment.BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS;
  if (raw === undefined) {
    return { uploadCapabilityTtlSeconds: 900 };
  }

  const normalized = raw.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new CloudRuntimeConfigurationError(
      "invalid-artifact-capability-ttl-seconds",
      "BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS must be an integer between 60 and 3600",
    );
  }

  const uploadCapabilityTtlSeconds = Number(normalized);
  if (
    !Number.isSafeInteger(uploadCapabilityTtlSeconds) ||
    uploadCapabilityTtlSeconds < 60 ||
    uploadCapabilityTtlSeconds > 3600
  ) {
    throw new CloudRuntimeConfigurationError(
      "invalid-artifact-capability-ttl-seconds",
      "BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS must be an integer between 60 and 3600",
    );
  }

  return { uploadCapabilityTtlSeconds };
}
