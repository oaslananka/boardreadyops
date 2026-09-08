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

export function calculateTtfufSeconds(installedAt: Date, findingProducedAt: Date): number {
  const diffMs = findingProducedAt.getTime() - installedAt.getTime();
  return Math.max(0, Math.floor(diffMs / 1000));
}

export function emitTelemetryEvent(
  eventData: TelemetryEvent,
  write: (line: string) => unknown = (line) => process.stdout.write(line),
): void {
  try {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "cloud-telemetry",
      ...eventData,
    });
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
