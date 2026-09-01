import { describe, expect, it, vi } from "vitest";
import { parseSentryDsn, sendSentryEvent } from "../../../apps/web/lib/sentry-worker-client.js";

describe("parseSentryDsn", () => {
  it("parses a standard sentry.io DSN", () => {
    expect(parseSentryDsn("https://examplepublickey@o123.ingest.sentry.io/456")).toEqual({
      publicKey: "examplepublickey",
      host: "o123.ingest.sentry.io",
      projectId: "456",
    });
  });

  it("parses a self-hosted DSN with a custom host", () => {
    expect(parseSentryDsn("https://key123@sentry.internal.example.com/7")).toEqual({
      publicKey: "key123",
      host: "sentry.internal.example.com",
      projectId: "7",
    });
  });

  it("returns undefined for an unparseable value", () => {
    expect(parseSentryDsn("not-a-url")).toBeUndefined();
  });

  it("returns undefined when the public key or project id is missing", () => {
    expect(parseSentryDsn("https://host.example.com/")).toBeUndefined();
    expect(parseSentryDsn("https://@host.example.com/1")).toBeUndefined();
  });
});

describe("sendSentryEvent", () => {
  it("posts an envelope to the DSN's project ingest endpoint with the public key in X-Sentry-Auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await sendSentryEvent(
      "https://examplepublickey@o123.ingest.sentry.io/456",
      { message: "worker.fatal", environment: "production", extra: { workerId: "w1" } },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": expect.stringContaining("sentry_key=examplepublickey"),
    });
    const lines = String(init.body).trim().split("\n");
    expect(lines).toHaveLength(3);
    const eventItem = JSON.parse(lines[2] ?? "{}");
    expect(eventItem).toMatchObject({
      level: "error",
      message: "worker.fatal",
      environment: "production",
      extra: { workerId: "w1" },
    });
  });

  it("does not throw and does not call fetch when the DSN is unparseable", async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendSentryEvent("not-a-dsn", { message: "x", environment: undefined, extra: {} }, fetchImpl),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows delivery failures instead of throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      sendSentryEvent("https://key@host.example.com/1", { message: "x", environment: undefined, extra: {} }, fetchImpl),
    ).resolves.toBeUndefined();
  });
});
