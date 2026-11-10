import * as Sentry from "@sentry/nextjs";

/**
 * Opt-in only: Sentry stays uninitialized (and sends nothing) unless SENTRY_DSN
 * is set. No default outbound telemetry, matching the CLI's privacy stance.
 */
export async function register(): Promise<void> {
  // Keep Next.js's built-in graceful shutdown. The readiness endpoint
  // must stop claiming this instance is available once drain begins.
  // Install listeners even when optional Sentry telemetry is disabled.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.once("SIGTERM", () => {
      process.env.BOARDREADYOPS_SHUTTING_DOWN = "1";
    });
    process.once("SIGINT", () => {
      process.env.BOARDREADYOPS_SHUTTING_DOWN = "1";
    });
  }

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const options: Sentry.NodeOptions = {
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(options);
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(options);
  }
}

// Captures errors from Server Components, Route Handlers, and middleware.
// Sentry.captureRequestError is a documented no-op when Sentry was never
// initialized above, so this is safe to export unconditionally.
export const onRequestError = Sentry.captureRequestError;
