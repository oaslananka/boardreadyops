type RetentionCleanupScope =
  | "artifact_upload_capabilities"
  | "repository_setup_probes"
  | "runner_registration_enrollments"
  | "runner_request_nonces"
  | "terminal_artifact_upload_capabilities"
  | "terminal_repository_setup_probes"
  | "terminal_runner_registration_enrollments"
  | "completed_control_plane_outbox"
  | "completed_control_plane_reconciliation_items"
  | "webhook_inbox";

type RetentionCleanupFailure = {
  scope: RetentionCleanupScope;
  errorClass: string;
};

export type RetentionCleanupResult = {
  webhookInboxPurged: number;
  runnerRequestNoncesPurged: number;
  artifactUploadCapabilitiesExpired: number;
  runnerRegistrationEnrollmentsRevoked: number;
  repositorySetupProbesExpired: number;
  terminalArtifactUploadCapabilitiesPurged: number;
  terminalRunnerRegistrationEnrollmentsPurged: number;
  terminalRepositorySetupProbesPurged: number;
  completedControlPlaneOutboxPurged: number;
  completedControlPlaneReconciliationItemsPurged: number;
  failures: RetentionCleanupFailure[];
  completed: boolean;
};

export type RetentionMaintenanceDependencies = {
  purgeWebhookInbox(): Promise<number>;
  purgeRunnerRequestNonces(): Promise<number>;
  expireArtifactUploadCapabilities(): Promise<number>;
  revokeExpiredRunnerRegistrationEnrollments(): Promise<number>;
  expireRepositorySetupProbes(): Promise<number>;
  purgeTerminalArtifactUploadCapabilities(): Promise<number>;
  purgeTerminalRunnerRegistrationEnrollments(): Promise<number>;
  purgeTerminalRepositorySetupProbes(): Promise<number>;
  purgeCompletedControlPlaneOutbox(): Promise<number>;
  purgeCompletedControlPlaneReconciliationItems(): Promise<number>;
};

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function runRetentionMaintenanceCleanup(
  dependencies: RetentionMaintenanceDependencies,
): Promise<RetentionCleanupResult> {
  const [
    webhookInbox,
    runnerRequestNonces,
    artifactUploadCapabilities,
    runnerRegistrationEnrollments,
    repositorySetupProbes,
    terminalArtifactUploadCapabilities,
    terminalRunnerRegistrationEnrollments,
    terminalRepositorySetupProbes,
    completedControlPlaneOutbox,
    completedControlPlaneReconciliationItems,
  ] = await Promise.allSettled([
    dependencies.purgeWebhookInbox(),
    dependencies.purgeRunnerRequestNonces(),
    dependencies.expireArtifactUploadCapabilities(),
    dependencies.revokeExpiredRunnerRegistrationEnrollments(),
    dependencies.expireRepositorySetupProbes(),
    dependencies.purgeTerminalArtifactUploadCapabilities(),
    dependencies.purgeTerminalRunnerRegistrationEnrollments(),
    dependencies.purgeTerminalRepositorySetupProbes(),
    dependencies.purgeCompletedControlPlaneOutbox(),
    dependencies.purgeCompletedControlPlaneReconciliationItems(),
  ]);
  const failures: RetentionCleanupFailure[] = [];
  const results = [
    ["webhook_inbox", webhookInbox],
    ["runner_request_nonces", runnerRequestNonces],
    ["artifact_upload_capabilities", artifactUploadCapabilities],
    ["runner_registration_enrollments", runnerRegistrationEnrollments],
    ["repository_setup_probes", repositorySetupProbes],
    ["terminal_artifact_upload_capabilities", terminalArtifactUploadCapabilities],
    ["terminal_runner_registration_enrollments", terminalRunnerRegistrationEnrollments],
    ["terminal_repository_setup_probes", terminalRepositorySetupProbes],
    ["completed_control_plane_outbox", completedControlPlaneOutbox],
    ["completed_control_plane_reconciliation_items", completedControlPlaneReconciliationItems],
  ] as const;
  for (const [scope, result] of results) {
    if (result.status === "rejected") failures.push({ scope, errorClass: errorClass(result.reason) });
  }
  return {
    webhookInboxPurged: webhookInbox.status === "fulfilled" ? webhookInbox.value : 0,
    runnerRequestNoncesPurged: runnerRequestNonces.status === "fulfilled" ? runnerRequestNonces.value : 0,
    artifactUploadCapabilitiesExpired:
      artifactUploadCapabilities.status === "fulfilled" ? artifactUploadCapabilities.value : 0,
    runnerRegistrationEnrollmentsRevoked:
      runnerRegistrationEnrollments.status === "fulfilled" ? runnerRegistrationEnrollments.value : 0,
    repositorySetupProbesExpired: repositorySetupProbes.status === "fulfilled" ? repositorySetupProbes.value : 0,
    terminalArtifactUploadCapabilitiesPurged:
      terminalArtifactUploadCapabilities.status === "fulfilled" ? terminalArtifactUploadCapabilities.value : 0,
    terminalRunnerRegistrationEnrollmentsPurged:
      terminalRunnerRegistrationEnrollments.status === "fulfilled" ? terminalRunnerRegistrationEnrollments.value : 0,
    terminalRepositorySetupProbesPurged:
      terminalRepositorySetupProbes.status === "fulfilled" ? terminalRepositorySetupProbes.value : 0,
    completedControlPlaneOutboxPurged:
      completedControlPlaneOutbox.status === "fulfilled" ? completedControlPlaneOutbox.value : 0,
    completedControlPlaneReconciliationItemsPurged:
      completedControlPlaneReconciliationItems.status === "fulfilled"
        ? completedControlPlaneReconciliationItems.value
        : 0,
    failures,
    completed: failures.length === 0,
  };
}
