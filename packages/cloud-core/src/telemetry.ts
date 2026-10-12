export type TelemetryEvent =
  | {
      event: "app_installed";
      installationId: number;
      accountType: string;
    }
  | {
      event: "setup_pr_opened";
      installationId: number;
      repositoryId: number;
      latencyMs: number;
    }
  | {
      event: "first_useful_finding_produced";
      installationId: number;
      repositoryId: number;
      latencyMs?: number | undefined;
      ruleCategory: string;
      severity: string;
      timeToFindingSeconds: number;
    };

export function isTtfufEvent(event: TelemetryEvent): boolean {
  return (
    event.event === "app_installed" ||
    event.event === "setup_pr_opened" ||
    event.event === "first_useful_finding_produced"
  );
}

/** Incomplete or contradictory external timestamps are not a zero-second activation. */
export function calculateTtfufSeconds(installedAt: Date, findingProducedAt?: Date): number | undefined {
  const diffMs = (findingProducedAt?.getTime() ?? Number.NaN) - installedAt.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return undefined;
  return Math.floor(diffMs / 1000);
}

export function emitTelemetryEvent(
  eventData: TelemetryEvent,
  write: (line: string) => unknown = (line) => process.stdout.write(line),
): void {
  try {
    // No unknown or object-valued field may reach the log through a typed
    // telemetry envelope that originated from a runtime payload.
    if (!Number.isSafeInteger(eventData.installationId) || eventData.installationId <= 0) return;
    if (
      eventData.event === "app_installed"
        ? typeof eventData.accountType !== "string"
        : eventData.event === "setup_pr_opened"
          ? !Number.isSafeInteger(eventData.repositoryId) ||
            !Number.isFinite(eventData.latencyMs) ||
            eventData.latencyMs < 0
          : eventData.event === "first_useful_finding_produced"
            ? !Number.isSafeInteger(eventData.repositoryId) ||
              typeof eventData.ruleCategory !== "string" ||
              typeof eventData.severity !== "string" ||
              !Number.isFinite(eventData.timeToFindingSeconds) ||
              eventData.timeToFindingSeconds < 0 ||
              (eventData.latencyMs !== undefined && (!Number.isFinite(eventData.latencyMs) || eventData.latencyMs < 0))
            : true
    )
      return;
    // Runtime payloads (webhooks, DB rows) are not protected by TypeScript's
    // excess-property checks. Allowlist the published fields by event variant.
    // Never serialize unknown keys that might contain customer design IP.
    const sanitized =
      eventData.event === "app_installed"
        ? { event: eventData.event, installationId: eventData.installationId, accountType: eventData.accountType }
        : eventData.event === "setup_pr_opened"
          ? {
              event: eventData.event,
              installationId: eventData.installationId,
              repositoryId: eventData.repositoryId,
              latencyMs: eventData.latencyMs,
            }
          : eventData.event === "first_useful_finding_produced"
            ? {
                event: eventData.event,
                installationId: eventData.installationId,
                repositoryId: eventData.repositoryId,
                ...(eventData.latencyMs === undefined ? {} : { latencyMs: eventData.latencyMs }),
                ruleCategory: eventData.ruleCategory,
                severity: eventData.severity,
                timeToFindingSeconds: eventData.timeToFindingSeconds,
              }
            : undefined;
    if (!sanitized) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), component: "cloud-telemetry", ...sanitized });
    write(`${line}\n`);
  } catch {
    // Fail silently in telemetry path to never break core app flows
  }
}

export interface TelemetryBuffer {
  record(event: TelemetryEvent): void;
  getEvents(): readonly TelemetryEvent[];
  clear(): void;
}

export function createTelemetryBuffer(capacity = 100): TelemetryBuffer {
  const events: TelemetryEvent[] = [];
  return {
    record(event: TelemetryEvent) {
      if (events.length >= capacity) {
        events.shift();
      }
      events.push(event);
    },
    getEvents() {
      return [...events];
    },
    clear() {
      events.length = 0;
    },
  };
}
