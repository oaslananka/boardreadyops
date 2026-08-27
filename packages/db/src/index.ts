export const cloudDatabaseSchemaVersion = 50;

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
  "BoardSupplyWatch",
  "BoardSupplyFinding",
  "ComponentLifecycleObservation",
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
  "Review",
  "ReviewRevision",
  "FindingDecision",
  "FindingAssignment",
  "ReviewComment",
  "ReviewApproval",
  "UploadManifest",
  "VisualSnapshot",
  "ExternalReviewLink",
  "ApiToken",
] as const;

export type CloudDatabaseModel = (typeof cloudDatabaseModels)[number];

export * from "./api-token-store.js";
export * from "./finding-decision-store.js";
export * from "./review-approval-store.js";
export * from "./review-collaboration-store.js";
export * from "./review-comment-store.js";
export * from "./review-store.js";
