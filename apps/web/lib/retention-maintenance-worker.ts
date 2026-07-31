type RetentionCleanupScope =
  | "artifact_upload_capabilities"
  | "repository_setup_probes"
  | "runner_registration_enrollments"
  | "runner_request_nonces"
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
  failures: RetentionCleanupFailure[];
  completed: boolean;
};

export type RetentionMaintenanceDependencies = {
  purgeWebhookInbox(): Promise<number>;
  purgeRunnerRequestNonces(): Promise<number>;
  expireArtifactUploadCapabilities(): Promise<number>;
  revokeExpiredRunnerRegistrationEnrollments(): Promise<number>;
  expireRepositorySetupProbes(): Promise<number>;
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
  ] = await Promise.allSettled([
    dependencies.purgeWebhookInbox(),
    dependencies.purgeRunnerRequestNonces(),
    dependencies.expireArtifactUploadCapabilities(),
    dependencies.revokeExpiredRunnerRegistrationEnrollments(),
    dependencies.expireRepositorySetupProbes(),
  ]);
  const failures: RetentionCleanupFailure[] = [];
  const results = [
    ["webhook_inbox", webhookInbox],
    ["runner_request_nonces", runnerRequestNonces],
    ["artifact_upload_capabilities", artifactUploadCapabilities],
    ["runner_registration_enrollments", runnerRegistrationEnrollments],
    ["repository_setup_probes", repositorySetupProbes],
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
    failures,
    completed: failures.length === 0,
  };
}
