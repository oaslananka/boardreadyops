import { describe, expect, it, vi } from "vitest";
import {
  createCompositeNotificationTransport,
  createSmtpNotificationTransport,
  maskNotificationDestination,
  type NotificationEvent,
  renderNotification,
  validateNotificationDestination,
} from "../../../packages/cloud-core/src/notifications.js";

const event: NotificationEvent = {
  type: "release.blocked",
  installationId: "inst-1",
  repositoryFullName: "acme/gateway",
  headline: "3 blocking findings stop this board from being fabricated",
  details: ["Pull request #42, commit e93d81b", "drc.clearance — 2 blocking findings"],
  url: "https://app.example/runs/run-1",
  dedupeKey: "run:run-1:blocked",
  occurredAt: "2026-09-14T10:00:00.000Z",
};

describe("email notification rendering", () => {
  it("puts the whole headline in the subject so it is actionable unopened", () => {
    const rendered = renderNotification(event, "email");
    const body = rendered.body as { subject: string; text: string };
    expect(body.subject).toBe("acme/gateway: 3 blocking findings stop this board from being fabricated");
    expect(body.text.startsWith(body.subject)).toBe(true);
    expect(body.text).toContain("- drc.clearance — 2 blocking findings");
    expect(body.text.trimEnd().endsWith("https://app.example/runs/run-1")).toBe(true);
  });

  it("renders plain text, not markup meant for another destination", () => {
    const body = renderNotification(event, "email").body as { text: string };
    expect(body.text).not.toContain("*");
    expect(body.text).not.toContain("mrkdwn");
    expect(body.text).not.toContain("&lt;");
  });

  it("omits the trailing link when the event has no url", () => {
    const { url: _url, ...withoutUrl } = event;
    const body = renderNotification(withoutUrl, "email").body as { text: string };
    expect(body.text).not.toContain("http");
  });
});

describe("email destinations", () => {
  it("accepts one ordinary address", () => {
    for (const address of ["hardware@example.com", "a.b+tag@sub.example.co.uk"]) {
      expect(validateNotificationDestination("email", address), address).toEqual({ ok: true });
    }
  });

  it("refuses anything that is not a single bare address", () => {
    for (const address of [
      "Hardware Team <hardware@example.com>",
      "one@example.com, two@example.com",
      "one@example.com; two@example.com",
      "no-at-sign",
      "@example.com",
      "trailing@",
      "no-dot@localhost",
      "dot@.example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(validateNotificationDestination("email", address).ok, address).toBe(false);
    }
  });

  it("masks the local part but keeps the domain recognisable", () => {
    expect(maskNotificationDestination("hardware-releases@example.com")).toBe("ha•••••••••••••••@example.com");
    expect(maskNotificationDestination("a@example.com")).toBe("a•@example.com");
    // A URL still masks as a URL: the two kinds share one column and one display path.
    expect(maskNotificationDestination("https://hooks.slack.com/services/T/B/abcdefghij")).toContain("hooks.slack.com");
  });
});

describe("SMTP notification transport", () => {
  const rendered = renderNotification(event, "email");

  function transport(sendEmail: (smtpUrl: string, message: unknown) => Promise<void>) {
    return createSmtpNotificationTransport({
      smtpUrl: "smtps://relay.example.com:465",
      from: "boardreadyops@example.com",
      sendEmail: sendEmail as never,
    });
  }

  it("sends the rendered subject and body to the one recipient", async () => {
    const sent: unknown[] = [];
    const result = await transport(async (_url, message) => {
      sent.push(message);
    }).deliver({ kind: "email", destination: "lead@example.com", rendered });

    expect(result).toEqual({ outcome: "delivered" });
    expect(sent[0]).toEqual({
      from: "boardreadyops@example.com",
      to: ["lead@example.com"],
      subject: "acme/gateway: 3 blocking findings stop this board from being fabricated",
      text: expect.stringContaining("drc.clearance"),
    });
  });

  it("treats a 5xx refusal as permanent and a 4xx as worth retrying", async () => {
    const permanent = await transport(async () => {
      throw new Error("SMTP 550");
    }).deliver({ kind: "email", destination: "gone@example.com", rendered });
    expect(permanent.outcome).toBe("permanent_failure");

    const retryable = await transport(async () => {
      throw new Error("SMTP 451");
    }).deliver({ kind: "email", destination: "busy@example.com", rendered });
    expect(retryable.outcome).toBe("retryable_failure");
  });

  it("treats a connection failure as retryable", async () => {
    const result = await transport(async () => {
      throw new Error("SMTP timeout");
    }).deliver({ kind: "email", destination: "lead@example.com", rendered });
    expect(result.outcome).toBe("retryable_failure");
  });

  it("refuses to send a body that is not an email rendering", async () => {
    const result = await transport(async () => undefined).deliver({
      kind: "email",
      destination: "lead@example.com",
      rendered: renderNotification(event, "slack"),
    });
    expect(result.outcome).toBe("permanent_failure");
  });
});

describe("composite notification transport", () => {
  const http = { deliver: vi.fn(async () => ({ outcome: "delivered" as const })) };
  const smtp = { deliver: vi.fn(async () => ({ outcome: "delivered" as const })) };

  it("routes each kind to the transport that can serve it", async () => {
    const composite = createCompositeNotificationTransport({ http, smtp });
    const rendered = renderNotification(event, "email");

    await composite.deliver({ kind: "slack", destination: "https://hooks.slack.com/x", rendered });
    await composite.deliver({ kind: "webhook", destination: "https://example.com/x", rendered });
    await composite.deliver({ kind: "email", destination: "lead@example.com", rendered });

    expect(http.deliver).toHaveBeenCalledTimes(2);
    expect(smtp.deliver).toHaveBeenCalledTimes(1);
  });

  it("explains itself rather than crashing when a deployment has no relay", async () => {
    // Reachable when a deployment drops its SMTP settings while an email channel still exists.
    const composite = createCompositeNotificationTransport({ http });
    const result = await composite.deliver({
      kind: "email",
      destination: "lead@example.com",
      rendered: renderNotification(event, "email"),
    });

    expect(result.outcome).toBe("permanent_failure");
    expect(result.outcome === "permanent_failure" && result.reason).toContain("no SMTP relay");
  });
});
