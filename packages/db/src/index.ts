export const cloudDatabaseSchemaVersion = 7;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
  "AuditEvent",
  "ReleaseRunResult",
  "ReleaseRunAttempt",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
