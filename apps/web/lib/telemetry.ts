export type FunnelEvent =
  | {
      event: "upload_started";
      cadFormat: string;
      archiveSizeBytes?: number | undefined;
      projectId?: string | undefined;
    }
  | {
      event: "upload_completed";
      cadFormat: string;
      fileCount: number;
      durationMs: number;
      outcome: "success" | "error";
      errorClass?: string | undefined;
    }
  | {
      event: "findings_inspected";
      findingId: string;
      ruleId?: string | undefined;
      severity: string;
      revisionId?: string | undefined;
    }
  | {
      event: "delivery_shared";
      revisionId: string;
      expiresAt: string;
      waiverCount: number;
      guestTokenPrefix?: string | undefined;
    };

export function emitFunnelTelemetry(
  eventData: FunnelEvent,
  write: (line: string) => unknown = (line) => process.stdout.write(line),
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    component: "platform-funnel",
    ...eventData,
  });
  write(`${line}\n`);
}
