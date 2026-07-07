export const cloudDatabaseSchemaVersion = 3;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
