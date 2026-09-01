/**
 * Minimal Sentry error-event sender for the control-plane worker.
 *
 * The full @sentry/node SDK statically references node:child_process deep in
 * its OpenTelemetry resource-detection and context-collection integrations
 * (present regardless of which integrations are registered at runtime,
 * because esbuild's static analysis follows the SDK's own barrel imports).
 * scripts/verify-control-plane-worker-boundary.mjs forbids child_process in
 * the worker bundle by design: the worker must never gain process-spawning
 * capability. Rather than fight the SDK's bundling or weaken that boundary,
 * this sends the same error envelope format directly over HTTP.
 *
 * Scope is deliberately narrow: one event type (error/message capture), no
 * tracing, no breadcrumbs, no session replay. If richer worker observability
 * is needed later, that's a new decision, not a silent expansion of this.
 */

export type SentryDsnParts = {
  publicKey: string;
  host: string;
  projectId: string;
};

export function parseSentryDsn(dsn: string): SentryDsnParts | undefined {
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    return undefined;
  }
  const publicKey = parsed.username;
  const projectId = parsed.pathname.split("/").findLast(Boolean);
  if (!publicKey || !projectId || !parsed.host) return undefined;
  return { publicKey, host: parsed.host, projectId };
}

function envelopeEndpoint(parts: SentryDsnParts): string {
  return `https://${parts.host}/api/${parts.projectId}/envelope/`;
}

export type SentryWorkerEvent = {
  message: string;
  environment: string | undefined;
  extra: Record<string, unknown>;
};

/**
 * Fire-and-forget: never throws and never awaited by callers for its
 * result, matching the worker's existing logging calls (log() also never
 * throws). A Sentry delivery failure must not affect worker behavior.
 */
export async function sendSentryEvent(
  dsn: string,
  event: SentryWorkerEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const parts = parseSentryDsn(dsn);
  if (!parts) return;

  const eventId = crypto.randomUUID().replaceAll("-", "");
  const sentAt = new Date().toISOString();
  const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn });
  const itemHeader = JSON.stringify({ type: "event" });
  const item = JSON.stringify({
    event_id: eventId,
    timestamp: sentAt,
    platform: "node",
    level: "error",
    message: event.message,
    environment: event.environment,
    extra: event.extra,
  });
  const body = `${envelopeHeader}\n${itemHeader}\n${item}\n`;

  try {
    await fetchImpl(envelopeEndpoint(parts), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=boardreadyops-worker/1.0, sentry_key=${parts.publicKey}`,
      },
      body,
    });
  } catch {
    // Delivery failures are swallowed; stdout logging already recorded the error.
  }
}
