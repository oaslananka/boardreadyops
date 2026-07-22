export const cloudDatabaseSchemaVersion = 16;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "RunnerRegistration",
  "RunnerRegistrationEnrollment",
  "RunnerExecutionPolicy",
  "ManagedRunnerIdentity",
  "RunnerJobLease",
  "RunnerRequestNonce",
  "RunnerArtifactUploadCapability",
  "AuditEvent",
  "ReleaseRunResult",
  "ReleaseRunAttempt",
  "WebhookInbox",
  "ControlPlaneJob",
  "ControlPlaneOutbox",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
