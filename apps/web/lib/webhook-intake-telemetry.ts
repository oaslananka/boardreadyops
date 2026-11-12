export type WebhookEventClass =
  | "check_run"
  | "workflow_run"
  | "installation"
  | "installation_repositories"
  | "pull_request"
  | "issue_comment"
  | "pull_request_review"
  | "ping"
  | "other";

export function webhookEventClass(event: string): WebhookEventClass {
  switch (event) {
    case "check_run":
    case "workflow_run":
    case "installation":
    case "installation_repositories":
    case "pull_request":
    case "issue_comment":
    case "pull_request_review":
    case "ping":
      return event;
    default:
      return "other";
  }
}

export type WebhookIntakeTelemetry = {
  outcome: "accepted" | "duplicate" | "enqueue_failed" | "ignored";
  latencyMs: number;
  eventClass?: WebhookEventClass;
  ignoredReason?: "no_action" | "marketplace_canceled" | "unsupported";
  errorClass?: string;
};

type Write = (line: string) => unknown;

/**
 * Strips a value down to what is safe to put in a log line.
 *
 * Exported so `repository-action-telemetry` reuses it: a thrown value's name or a database error
 * code both arrive from outside and neither should be able to inject a newline into a
 * line-delimited log stream.
 */
export function boundedErrorClass(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/[^A-Za-z0-9_.:-]/gu, "");
  return normalized ? normalized.slice(0, 100) : undefined;
}

export function emitWebhookIntakeTelemetry(
  telemetry: WebhookIntakeTelemetry,
  write: Write = (line) => process.stdout.write(line),
): void {
  const errorClass = boundedErrorClass(telemetry.errorClass);
  write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: telemetry.outcome === "enqueue_failed" ? "error" : "info",
      component: "github-webhook-intake",
      event: "webhook.intake",
      outcome: telemetry.outcome,
      latencyMs: Math.max(0, Math.round(telemetry.latencyMs)),
      ...(telemetry.eventClass ? { eventClass: telemetry.eventClass } : {}),
      ...(telemetry.ignoredReason ? { ignoredReason: telemetry.ignoredReason } : {}),
      ...(errorClass ? { errorClass } : {}),
    })}\n`,
  );
}
