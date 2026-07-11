export const cloudDatabaseSchemaVersion = 5;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
  "AuditEvent",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
