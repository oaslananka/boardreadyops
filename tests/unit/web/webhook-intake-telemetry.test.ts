import { describe, expect, it, vi } from "vitest";
import { emitWebhookIntakeTelemetry } from "../../../apps/web/lib/webhook-intake-telemetry.js";

describe("webhook intake telemetry", () => {
  it("emits bounded aggregate fields without delivery or tenant identifiers", () => {
    const write = vi.fn<(line: string) => boolean>(() => true);

    emitWebhookIntakeTelemetry(
      {
        outcome: "duplicate",
        latencyMs: 12.7,
      },
      write,
    );

    expect(write).toHaveBeenCalledOnce();
    const line = String(write.mock.calls[0]?.[0]);
    const event = JSON.parse(line) as Record<string, unknown>;
    expect(event).toMatchObject({
      component: "github-webhook-intake",
      event: "webhook.intake",
      outcome: "duplicate",
      latencyMs: 13,
    });
    expect(line).not.toContain("delivery");
    expect(line).not.toContain("repository");
    expect(line).not.toContain("installation");
  });

  it("records enqueue failures without serializing error messages", () => {
    const write = vi.fn<(line: string) => boolean>(() => true);

    emitWebhookIntakeTelemetry(
      {
        outcome: "enqueue_failed",
        latencyMs: 22,
        errorClass: "DatabaseError",
      },
      write,
    );

    const line = String(write.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      outcome: "enqueue_failed",
      errorClass: "DatabaseError",
    });
    expect(line).not.toContain("password");
  });
});
