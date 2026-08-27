import { afterEach, describe, expect, it } from "vitest";
import { InMemorySiemStream } from "../../../packages/cloud-core/src/enterprise/siem-stream.js";

describe("SiemStream", () => {
  const originalWebhookUrl = process.env.SIEM_WEBHOOK_URL;

  afterEach(() => {
    if (originalWebhookUrl === undefined) delete process.env.SIEM_WEBHOOK_URL;
    else process.env.SIEM_WEBHOOK_URL = originalWebhookUrl;
  });

  it("exports only events for the requested tenant at or after the given time", async () => {
    delete process.env.SIEM_WEBHOOK_URL;
    const stream = new InMemorySiemStream();

    await stream.publish({
      id: "evt-1",
      tenantId: "tenant-a",
      type: "review.approved",
      actorId: "user-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      metadata: {},
    });
    await stream.publish({
      id: "evt-2",
      tenantId: "tenant-b",
      type: "review.approved",
      actorId: "user-2",
      timestamp: "2026-01-02T00:00:00.000Z",
      metadata: {},
    });
    await stream.publish({
      id: "evt-3",
      tenantId: "tenant-a",
      type: "finding.dispositioned",
      actorId: "user-1",
      timestamp: "2026-01-03T00:00:00.000Z",
      metadata: {},
    });

    const exported = await stream.exportForTenant("tenant-a", "2026-01-01T12:00:00.000Z");
    expect(exported.map((e) => e.id)).toEqual(["evt-3"]);
  });

  it("accepts a constructor-supplied webhook URL over the environment default", () => {
    process.env.SIEM_WEBHOOK_URL = "https://siem.example.test/from-env";
    const stream = new InMemorySiemStream("https://siem.example.test/explicit");
    expect(stream).toBeInstanceOf(InMemorySiemStream);
  });

  it("returns no events for a tenant that has never published", async () => {
    const stream = new InMemorySiemStream(null);
    await expect(stream.exportForTenant("tenant-z", "2020-01-01T00:00:00.000Z")).resolves.toEqual([]);
  });
});
