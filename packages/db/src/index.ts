export const cloudDatabaseSchemaVersion = 6;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
  "AuditEvent",
  "ReleaseRunResult",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
