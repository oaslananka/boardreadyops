export const cloudDatabaseSchemaVersion = 4;

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
