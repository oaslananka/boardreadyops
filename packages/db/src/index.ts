export const cloudDatabaseSchemaVersion = 27;

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
  "ReleaseRunTransitionEvent",
  "WebhookInbox",
  "ControlPlaneJob",
  "ControlPlaneOutbox",
  "ControlPlaneReconciliationItem",
  "ControlPlaneReplayOperation",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];
