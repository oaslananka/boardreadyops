import type { NotificationEvent, NotificationTransportResult } from "@boardreadyops/cloud-core/notifications";
import type { ClaimedNotificationDelivery, NotificationStore } from "@boardreadyops/db/notification-store";
import { describe, expect, it, vi } from "vitest";
import { runNotificationDeliveryPass } from "../../../apps/web/lib/notification-worker.js";

const event: NotificationEvent = {
  type: "release.blocked",
  installationId: "inst-1",
  repositoryFullName: "acme/gateway",
  headline: "3 blocking findings stop this board from being fabricated",
  details: ["drc.clearance — 2 violations"],
  dedupeKey: "run:run-1",
  occurredAt: "2026-09-14T10:00:00.000Z",
};

function delivery(overrides: Partial<ClaimedNotificationDelivery> = {}): ClaimedNotificationDelivery {
  return {
    id: "del-1",
    channelId: "chan-1",
    kind: "slack",
    destination: "https://hooks.slack.com/services/x",
    eventType: "release.blocked",
    event,
    attemptCount: 1,
    ...overrides,
  };
}

function storeWith(deliveries: ClaimedNotificationDelivery[]) {
  const completeDelivery = vi.fn(async () => undefined);
  const failDelivery = vi.fn(async () => undefined);
  const store = {
    claimDeliveries: vi.fn(async () => deliveries),
    completeDelivery,
    failDelivery,
    listChannels: vi.fn(),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
    enqueueEvent: vi.fn(),
  } as unknown as NotificationStore;
  return { store, completeDelivery, failDelivery };
}

function transportReturning(...results: NotificationTransportResult[]) {
  const queue = [...results];
  return {
    deliver: vi.fn(async () => queue.shift() ?? { outcome: "delivered" as const }),
  };
}

describe("notification delivery pass", () => {
  it("delivers a claimed notification and records it", async () => {
    const { store, completeDelivery, failDelivery } = storeWith([delivery()]);
    const transport = transportReturning({ outcome: "delivered" });

    const result = await runNotificationDeliveryPass({ store, transport, workerId: "worker-1" });

    expect(result).toEqual({ claimed: 1, delivered: 1, retried: 0, deadLettered: 0 });
    expect(completeDelivery).toHaveBeenCalledWith({ deliveryId: "del-1" });
    expect(failDelivery).not.toHaveBeenCalled();
  });

  it("renders per channel kind, so Slack gets blocks and a webhook gets the event", async () => {
    const { store } = storeWith([delivery(), delivery({ id: "del-2", kind: "webhook" })]);
    const transport = transportReturning({ outcome: "delivered" }, { outcome: "delivered" });

    await runNotificationDeliveryPass({ store, transport, workerId: "worker-1" });

    const bodies = transport.deliver.mock.calls.map((call) => call[0].rendered.body as Record<string, unknown>);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.blocks).toBeDefined();
    expect(bodies[1]?.type).toBe("release.blocked");
  });

  it("retries a transient failure rather than dropping the news", async () => {
    const { store, failDelivery, completeDelivery } = storeWith([delivery()]);
    const transport = transportReturning({ outcome: "retryable_failure", reason: "destination responded 503" });

    const result = await runNotificationDeliveryPass({ store, transport, workerId: "worker-1" });

    expect(result).toEqual({ claimed: 1, delivered: 0, retried: 1, deadLettered: 0 });
    expect(completeDelivery).not.toHaveBeenCalled();
    expect(failDelivery).toHaveBeenCalledWith({
      deliveryId: "del-1",
      reason: "destination responded 503",
      permanent: false,
    });
  });

  it("dead-letters a permanently rejected destination instead of retrying it six times", async () => {
    // A webhook whose Slack app was uninstalled answers 404 forever; retrying only delays the
    // moment the channel's owner sees the error and fixes it.
    const { store, failDelivery } = storeWith([delivery()]);
    const transport = transportReturning({ outcome: "permanent_failure", reason: "destination responded 404" });

    const result = await runNotificationDeliveryPass({ store, transport, workerId: "worker-1" });

    expect(result).toEqual({ claimed: 1, delivered: 0, retried: 0, deadLettered: 1 });
    expect(failDelivery).toHaveBeenCalledWith({
      deliveryId: "del-1",
      reason: "destination responded 404",
      permanent: true,
    });
  });

  it("keeps going past one broken channel so a second channel still hears", async () => {
    const { store, completeDelivery } = storeWith([delivery(), delivery({ id: "del-2", channelId: "chan-2" })]);
    const transport = transportReturning({ outcome: "permanent_failure", reason: "gone" }, { outcome: "delivered" });

    const result = await runNotificationDeliveryPass({ store, transport, workerId: "worker-1" });

    expect(result).toEqual({ claimed: 2, delivered: 1, retried: 0, deadLettered: 1 });
    expect(completeDelivery).toHaveBeenCalledWith({ deliveryId: "del-2" });
  });

  it("does nothing when the outbox is empty", async () => {
    const { store } = storeWith([]);
    const transport = transportReturning();
    const result = await runNotificationDeliveryPass({ store, transport, workerId: "worker-1" });
    expect(result).toEqual({ claimed: 0, delivered: 0, retried: 0, deadLettered: 0 });
    expect(transport.deliver).not.toHaveBeenCalled();
  });
});
