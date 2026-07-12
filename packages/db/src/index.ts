export const cloudDatabaseSchemaVersion = 8;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
  "ManagedRunnerIdentity",
  "RunnerJobLease",
  "RunnerRequestNonce",
  "AuditEvent",
  "ReleaseRunResult",
  "ReleaseRunAttempt",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
