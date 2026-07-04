export const cloudDatabaseSchemaVersion = 1;

export const cloudDatabaseModels = ["Installation", "Repository", "ReleaseRun", "Finding", "Artifact"] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
