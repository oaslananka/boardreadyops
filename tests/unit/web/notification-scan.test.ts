import type { NotificationEvent } from "@boardreadyops/cloud-core/notifications";
import type { ExpiringWaiver, NotificationStore, StalledReview } from "@boardreadyops/db/notification-store";
import { describe, expect, it, vi } from "vitest";
import {
  expiringWaiverEvent,
  runNotificationScanPass,
  stalledReviewEvent,
} from "../../../apps/web/lib/notification-worker.js";

const now = new Date("2026-09-14T10:00:00.000Z");

const waiver: ExpiringWaiver = {
  decisionId: "dec-1",
  installationId: "inst-1",
  repositoryFullName: "acme/gateway",
  reviewId: "rev-1",
  pullRequestNumber: 42,
  findingFingerprint: "fp-1",
  owner: "sarah.chen",
  reason: "Second source qualified; fab confirmed the clearance is within tolerance.",
  expiresAt: "2026-09-17T10:00:00.000Z",
};

const review: StalledReview = {
  reviewId: "rev-9",
  installationId: "inst-1",
  repositoryFullName: "acme/ble-sensor",
  pullRequestNumber: 9,
  title: "Switch to nRF52840 WLCSP",
  createdBy: "david.wong",
  awaitingSince: "2026-09-10T10:00:00.000Z",
};

function storeWith(waivers: ExpiringWaiver[], reviews: StalledReview[]) {
  const enqueued: NotificationEvent[] = [];
  const store = {
    listExpiringWaivers: vi.fn(async () => waivers),
    listStalledReviews: vi.fn(async () => reviews),
    enqueueEvent: vi.fn(async (event: NotificationEvent) => {
      enqueued.push(event);
      return 1;
    }),
    claimDeliveries: vi.fn(),
    completeDelivery: vi.fn(),
    failDelivery: vi.fn(),
    listChannels: vi.fn(),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
  } as unknown as NotificationStore;
  return { store, enqueued };
}

describe("expiring waiver notification", () => {
  it("says how long is left and why the risk was accepted", () => {
    const event = expiringWaiverEvent(waiver, now, "https://app.example");
    expect(event.type).toBe("waiver.expiring");
    expect(event.headline).toBe("A risk acceptance lapses in 3 days and will start blocking releases again");
    expect(event.details).toContain("Pull request #42");
    expect(event.details[1]).toContain("Accepted by sarah.chen");
    expect(event.url).toBe("https://app.example/reviews/rev-1");
  });

  it("announces one waiver once, however many times the scan runs", () => {
    const first = expiringWaiverEvent(waiver, now, undefined);
    const later = expiringWaiverEvent(waiver, new Date("2026-09-15T10:00:00.000Z"), undefined);
    expect(first.dedupeKey).toBe("waiver:dec-1");
    expect(later.dedupeKey).toBe(first.dedupeKey);
  });

  it("says today rather than in 0 days on the last day", () => {
    const event = expiringWaiverEvent({ ...waiver, expiresAt: "2026-09-14T16:00:00.000Z" }, now, undefined);
    expect(event.headline).toContain("lapses today");
  });

  it("falls back to the review id when the waiver is not on a pull request", () => {
    const event = expiringWaiverEvent({ ...waiver, pullRequestNumber: undefined }, now, undefined);
    expect(event.details).toContain("Review rev-1");
  });
});

describe("stalled review notification", () => {
  it("says how long it has been waiting and who opened it", () => {
    const event = stalledReviewEvent(review, now, "https://app.example");
    expect(event.type).toBe("review.decision_requested");
    expect(event.headline).toBe("A review has been waiting 4 days for a decision");
    expect(event.details).toContain("Switch to nRF52840 WLCSP");
    expect(event.details).toContain("Opened by david.wong");
  });

  it("nudges at most once a day rather than on every scan", () => {
    const morning = stalledReviewEvent(review, new Date("2026-09-14T08:00:00.000Z"), undefined);
    const evening = stalledReviewEvent(review, new Date("2026-09-14T20:00:00.000Z"), undefined);
    const tomorrow = stalledReviewEvent(review, new Date("2026-09-15T08:00:00.000Z"), undefined);
    expect(evening.dedupeKey).toBe(morning.dedupeKey);
    expect(tomorrow.dedupeKey).not.toBe(morning.dedupeKey);
  });
});

describe("time-based notification scan", () => {
  it("queues both kinds and reports what it queued", async () => {
    const { store, enqueued } = storeWith([waiver], [review]);
    const result = await runNotificationScanPass({ store }, { now, publicUrl: "https://app.example/" });

    expect(result).toEqual({ waiversQueued: 1, reviewsQueued: 1 });
    expect(enqueued.map((event) => event.type)).toEqual(["waiver.expiring", "review.decision_requested"]);
    // The trailing slash on the configured origin must not become a double slash in the link.
    expect(enqueued[0]?.url).toBe("https://app.example/reviews/rev-1");
  });

  it("asks for the horizons the product promises", async () => {
    const { store } = storeWith([], []);
    await runNotificationScanPass({ store }, { now });

    expect(store.listExpiringWaivers).toHaveBeenCalledWith({ now, withinMs: 7 * 24 * 60 * 60 * 1000 });
    expect(store.listStalledReviews).toHaveBeenCalledWith({ now, olderThanMs: 2 * 24 * 60 * 60 * 1000 });
  });

  it("does nothing when there is nothing due", async () => {
    const { store, enqueued } = storeWith([], []);
    const result = await runNotificationScanPass({ store }, { now });
    expect(result).toEqual({ waiversQueued: 0, reviewsQueued: 0 });
    expect(enqueued).toEqual([]);
  });
});
