type CloudPersistenceMode = "postgres" | "memory";

export type CloudRuntimeConfigurationErrorCode =
  | "invalid-persistence-mode"
  | "memory-persistence-not-allowed"
  | "missing-database-url";

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
