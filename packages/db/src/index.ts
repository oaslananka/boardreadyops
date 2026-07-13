export const cloudDatabaseSchemaVersion = 13;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
  "RunnerRegistrationEnrollment",
  "ManagedRunnerIdentity",
  "RunnerJobLease",
  "RunnerRequestNonce",
  "RunnerArtifactUploadCapability",
  "AuditEvent",
  "ReleaseRunResult",
  "ReleaseRunAttempt",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
