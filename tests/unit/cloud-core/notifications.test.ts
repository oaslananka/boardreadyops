import { describe, expect, it, vi } from "vitest";
import {
  createHttpNotificationTransport,
  defaultSubscribedEvents,
  escapeSlackText,
  isNotificationEventType,
  maskNotificationDestination,
  type NotificationEvent,
  notificationEventCatalog,
  renderNotification,
  validateNotificationDestination,
} from "../../../packages/cloud-core/src/notifications.js";

const event: NotificationEvent = {
  type: "supply.risk_detected",
  installationId: "inst-1",
  repositoryFullName: "acme/gateway",
  headline: "STM32F401RET6 is EOL and is on this board",
  details: ["STM32F401RET6 (U1) — EOL, critical risk"],
  url: "https://app.example/parts",
  dedupeKey: "supply:board-1:abc",
  occurredAt: "2026-09-14T10:00:00.000Z",
};

describe("notification event catalogue", () => {
  it("only offers events the product can actually detect", () => {
    expect(notificationEventCatalog.map((entry) => entry.type)).toEqual([
      "release.blocked",
      "supply.risk_detected",
      "waiver.expiring",
      "review.decision_requested",
      "release.ready",
    ]);
    expect(isNotificationEventType("supply.risk_detected")).toBe(true);
    expect(isNotificationEventType("anything.else")).toBe(false);
  });

  it("defaults a new channel to the events worth interrupting someone for", () => {
    // A channel subscribed to everything gets muted, and a muted channel is the same as none.
    const defaults = defaultSubscribedEvents();
    expect(defaults).toContain("supply.risk_detected");
    expect(defaults).toContain("release.blocked");
    expect(defaults).not.toContain("release.ready");
  });
});

describe("notification rendering", () => {
  it("renders Slack mrkdwn with the link and every detail", () => {
    const rendered = renderNotification(event, "slack");
    expect(rendered.text).toBe("acme/gateway: STM32F401RET6 is EOL and is on this board");
    const body = rendered.body as { blocks: { text: { text: string } }[] };
    const block = body.blocks[0]?.text.text ?? "";
    expect(block).toContain("*acme/gateway:");
    expect(block).toContain("• STM32F401RET6 (U1)");
    expect(block).toContain("<https://app.example/parts|Open in BoardReadyOps>");
  });

  it("gives a generic webhook the event, not a rendering of it", () => {
    const body = renderNotification(event, "webhook").body as Record<string, unknown>;
    expect(body.type).toBe("supply.risk_detected");
    expect(body.repository).toBe("acme/gateway");
    expect(body.url).toBe("https://app.example/parts");
    expect(body).not.toHaveProperty("blocks");
  });

  it("escapes Slack markup so a repository or part name cannot inject it", () => {
    expect(escapeSlackText("<!channel> & <https://evil>")).toBe("&lt;!channel&gt; &amp; &lt;https://evil&gt;");
    const hostile = { ...event, repositoryFullName: "<!channel>" };
    const body = renderNotification(hostile, "slack").body as { text: string };
    expect(body.text).not.toContain("<!channel>");
  });

  it("bounds the detail list so one board cannot produce an unreadable message", () => {
    const many = { ...event, details: Array.from({ length: 40 }, (_, index) => `part-${index}`) };
    const body = renderNotification(many, "webhook").body as { details: string[] };
    expect(body.details).toHaveLength(8);
  });
});

describe("notification destinations", () => {
  it("accepts a Slack incoming webhook and rejects anything else claiming to be one", () => {
    expect(validateNotificationDestination("slack", "https://hooks.slack.com/services/T/B/x")).toEqual({ ok: true });
    const wrongHost = validateNotificationDestination("slack", "https://evil.example/services/T/B/x");
    expect(wrongHost.ok).toBe(false);
  });

  it("refuses the request-forgery shapes", () => {
    // The control plane POSTs to these on a schedule it controls, so an unvalidated destination
    // would be an SSRF primitive rather than a configuration mistake.
    for (const destination of [
      "http://hooks.slack.com/services/T/B/x",
      "https://user:pass@example.com/hook",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://192.168.0.5/hook",
      "https://172.16.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/x",
      "https://build.internal/hook",
      "not-a-url",
    ]) {
      const result = validateNotificationDestination("webhook", destination);
      expect(result.ok, destination).toBe(false);
    }
  });

  it("shows enough of a destination to recognise it and not enough to reuse it", () => {
    const masked = maskNotificationDestination("https://hooks.slack.com/services/T0001/B0002/abcdefghijklmnop");
    expect(masked).toContain("hooks.slack.com");
    expect(masked).not.toContain("abcdefghijklmnop");
    expect(masked).toContain("mnop");
    expect(maskNotificationDestination("garbage")).toBe("…");
  });
});

describe("HTTP notification transport", () => {
  function transportWith(response: Response | Error) {
    const fetchMock = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    return {
      fetchMock,
      transport: createHttpNotificationTransport({ fetch: fetchMock as unknown as typeof globalThis.fetch }),
    };
  }

  const rendered = renderNotification(event, "slack");

  it("reports a 2xx as delivered", async () => {
    const { transport, fetchMock } = transportWith(new Response("ok", { status: 200 }));
    await expect(
      transport.deliver({ kind: "slack", destination: "https://hooks.slack.com/x", rendered }),
    ).resolves.toEqual({ outcome: "delivered" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a rejected destination as permanent so it is not retried forever", async () => {
    for (const status of [400, 401, 403, 404, 410]) {
      const { transport } = transportWith(new Response("no", { status }));
      const result = await transport.deliver({ kind: "slack", destination: "https://hooks.slack.com/x", rendered });
      expect(result.outcome).toBe("permanent_failure");
    }
  });

  it("treats a rate limit or server error as retryable", async () => {
    for (const status of [429, 500, 502, 503]) {
      const { transport } = transportWith(new Response("later", { status }));
      const result = await transport.deliver({ kind: "slack", destination: "https://hooks.slack.com/x", rendered });
      expect(result.outcome).toBe("retryable_failure");
    }
  });

  it("treats a network failure as retryable and does not leak the stack", async () => {
    const { transport } = transportWith(new Error("ECONNRESET while connecting"));
    const result = await transport.deliver({ kind: "webhook", destination: "https://example.com/x", rendered });
    expect(result.outcome).toBe("retryable_failure");
    expect(result.outcome === "retryable_failure" && result.reason).toContain("ECONNRESET");
  });
});
