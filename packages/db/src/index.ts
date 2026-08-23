export const cloudDatabaseSchemaVersion = 40;

export const cloudDatabaseModels = [
  "Installation",
  "Repository",
  "RepositorySetupRevision",
  "RepositorySetupProbe",
  "ReleaseRun",
  "Finding",
  "Artifact",
  "ArtifactDeletionJob",
  "Board",
  "BoardBomSnapshot",
  "BoardBomComponent",
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
