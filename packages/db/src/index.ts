export const cloudDatabaseSchemaVersion = 22;

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
  "ControlPlaneReconciliationItem",
  "ControlPlaneReplayOperation",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
