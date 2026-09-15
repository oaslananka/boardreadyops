export type WebhookIntakeTelemetry = {
  outcome: "accepted" | "duplicate" | "enqueue_failed";
  latencyMs: number;
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
      ...(errorClass ? { errorClass } : {}),
    })}\n`,
  );
}
