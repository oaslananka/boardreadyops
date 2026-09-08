import { describe, expect, it } from "vitest";
import {
  calculateTtfufSeconds,
  createTelemetryBuffer,
  emitTelemetryEvent,
  isTtfufEvent,
} from "../../../packages/cloud-core/src/telemetry.js";

describe("TTFUF telemetry emitter", () => {
  it("emits valid privacy-safe app_installed event", () => {
    const lines: string[] = [];
    emitTelemetryEvent(
      {
        event: "app_installed",
        installationId: 12345,
        accountType: "Organization",
      },
      (line) => lines.push(line),
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.component).toBe("cloud-telemetry");
    expect(parsed.event).toBe("app_installed");
    expect(parsed.installationId).toBe(12345);
    expect(parsed.accountType).toBe("Organization");
    expect(parsed.timestamp).toBeDefined();
  });

  it("emits setup_pr_opened event with latency", () => {
    const lines: string[] = [];
    emitTelemetryEvent(
      {
        event: "setup_pr_opened",
        installationId: 12345,
        repositoryId: 9876,
        latencyMs: 1420,
      },
      (line) => lines.push(line),
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.event).toBe("setup_pr_opened");
    expect(parsed.latencyMs).toBe(1420);
  });

  it("emits first_useful_finding_produced without sensitive design IP", () => {
    const lines: string[] = [];
    emitTelemetryEvent(
      {
        event: "first_useful_finding_produced",
        installationId: 12345,
        repositoryId: 9876,
        ruleCategory: "bom",
        severity: "high",
        timeToFindingSeconds: 78,
      },
      (line) => lines.push(line),
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.event).toBe("first_useful_finding_produced");
    expect(parsed.ruleCategory).toBe("bom");
    expect(parsed.severity).toBe("high");
    expect(parsed.timeToFindingSeconds).toBe(78);
    // Crucial privacy check: ensure no board paths or component values leaked
    expect(parsed.path).toBeUndefined();
    expect(parsed.mpn).toBeUndefined();
    expect(parsed.net).toBeUndefined();
  });

  it("calculates TTFUF in whole seconds correctly", () => {
    const installedAt = new Date("2026-09-08T08:00:00.000Z");
    const foundAt = new Date("2026-09-08T08:02:15.500Z");
    const seconds = calculateTtfufSeconds(installedAt, foundAt);
    expect(seconds).toBe(135);
  });

  it("identifies TTFUF-relevant events", () => {
    expect(
      isTtfufEvent({
        event: "first_useful_finding_produced",
        installationId: 1,
        repositoryId: 2,
        ruleCategory: "bom",
        severity: "error",
        timeToFindingSeconds: 10,
      }),
    ).toBe(true);
    expect(isTtfufEvent({ event: "setup_pr_opened", installationId: 1, repositoryId: 2, latencyMs: 500 })).toBe(true);
    expect(isTtfufEvent({ event: "app_installed", installationId: 1, accountType: "User" })).toBe(true);
  });

  it("buffers telemetry events in memory safely without throwing", () => {
    const buffer = createTelemetryBuffer(5);
    buffer.record({ event: "app_installed", installationId: 1, accountType: "User" });
    buffer.record({ event: "setup_pr_opened", installationId: 1, repositoryId: 2, latencyMs: 100 });

    const items = buffer.getEvents();
    expect(items).toHaveLength(2);
    expect(items[0]?.event).toBe("app_installed");
    expect(items[1]?.event).toBe("setup_pr_opened");
  });
});
