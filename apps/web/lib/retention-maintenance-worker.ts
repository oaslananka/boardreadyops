type RetentionCleanupScope = "runner_request_nonces" | "webhook_inbox";

type RetentionCleanupFailure = {
  scope: RetentionCleanupScope;
  errorClass: string;
};

export type RetentionCleanupResult = {
  webhookInboxPurged: number;
  runnerRequestNoncesPurged: number;
  failures: RetentionCleanupFailure[];
  completed: boolean;
};

export type RetentionMaintenanceDependencies = {
  purgeWebhookInbox(): Promise<number>;
  purgeRunnerRequestNonces(): Promise<number>;
};

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function runRetentionMaintenanceCleanup(
  dependencies: RetentionMaintenanceDependencies,
): Promise<RetentionCleanupResult> {
  const [webhookInbox, runnerRequestNonces] = await Promise.allSettled([
    dependencies.purgeWebhookInbox(),
    dependencies.purgeRunnerRequestNonces(),
  ]);
  const failures: RetentionCleanupFailure[] = [];
  if (webhookInbox.status === "rejected") {
    failures.push({ scope: "webhook_inbox", errorClass: errorClass(webhookInbox.reason) });
  }
  if (runnerRequestNonces.status === "rejected") {
    failures.push({ scope: "runner_request_nonces", errorClass: errorClass(runnerRequestNonces.reason) });
  }
  return {
    webhookInboxPurged: webhookInbox.status === "fulfilled" ? webhookInbox.value : 0,
    runnerRequestNoncesPurged: runnerRequestNonces.status === "fulfilled" ? runnerRequestNonces.value : 0,
    failures,
    completed: failures.length === 0,
  };
}
