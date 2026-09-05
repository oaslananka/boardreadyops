import { describe, expect, it } from "vitest";
import { emitFunnelTelemetry, type FunnelEvent } from "../../../apps/web/lib/telemetry.js";

describe("Platform Funnel Telemetry", () => {
  it("emits structured json telemetry for upload_started event", () => {
    const lines: string[] = [];
    const event: FunnelEvent = {
      event: "upload_started",
      cadFormat: "altium",
      archiveSizeBytes: 1048576,
      projectId: "proj_123",
    };

    emitFunnelTelemetry(event, (line) => lines.push(line));

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.event).toBe("upload_started");
    expect(parsed.component).toBe("platform-funnel");
    expect(parsed.cadFormat).toBe("altium");
    expect(parsed.projectId).toBe("proj_123");
    expect(parsed.timestamp).toBeDefined();
  });

  it("emits structured json telemetry for upload_completed event", () => {
    const lines: string[] = [];
    const event: FunnelEvent = {
      event: "upload_completed",
      cadFormat: "kicad",
      fileCount: 14,
      durationMs: 450,
      outcome: "success",
    };

    emitFunnelTelemetry(event, (line) => lines.push(line));

    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.event).toBe("upload_completed");
    expect(parsed.outcome).toBe("success");
    expect(parsed.fileCount).toBe(14);
  });

  it("emits structured json telemetry for findings_inspected event", () => {
    const lines: string[] = [];
    const event: FunnelEvent = {
      event: "findings_inspected",
      findingId: "fnd_polarity_1",
      ruleId: "DFM_POLARITY_MARKER",
      severity: "error",
      revisionId: "rev_abc",
    };

    emitFunnelTelemetry(event, (line) => lines.push(line));

    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.event).toBe("findings_inspected");
    expect(parsed.findingId).toBe("fnd_polarity_1");
    expect(parsed.severity).toBe("error");
  });

  it("emits structured json telemetry for delivery_shared event", () => {
    const lines: string[] = [];
    const event: FunnelEvent = {
      event: "delivery_shared",
      revisionId: "rev_abc",
      expiresAt: "2026-09-12T00:00:00.000Z",
      waiverCount: 2,
      guestTokenPrefix: "deliv_token_",
    };

    emitFunnelTelemetry(event, (line) => lines.push(line));

    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.event).toBe("delivery_shared");
    expect(parsed.waiverCount).toBe(2);
    expect(parsed.expiresAt).toBe("2026-09-12T00:00:00.000Z");
  });
});
