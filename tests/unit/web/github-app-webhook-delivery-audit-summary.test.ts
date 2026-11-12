import { describe, expect, it } from "vitest";
import {
  auditOptions,
  deliveryGapSummary,
  parseNextCursor,
} from "../../../apps/web/scripts/audit-github-app-webhooks.mjs";
import { delivery, guidA, guidB, guidC } from "./github-app-webhook-delivery-audit-fixtures";

describe("GitHub App webhook delivery safety audit", () => {
  it("bounds the retained history and API scan", () => {
    expect(auditOptions({}).windowHours).toBe(24);
    expect(() => auditOptions({ BOARDREADYOPS_WEBHOOK_AUDIT_HOURS: "73" })).toThrow();
    expect(() => auditOptions({ BOARDREADYOPS_WEBHOOK_AUDIT_MAX_PAGES: "0" })).toThrow();
    expect(() => auditOptions({ BOARDREADYOPS_WEBHOOK_AUDIT_MAX_PAGES: "500" })).toThrow();
  });
  it("rejects non-GitHub pagination and unexpected API query mutations", () => {
    expect(() => parseNextCursor('<https://evil.example/app/hook/deliveries?cursor=1>; rel="next"')).toThrow();
    expect(() =>
      parseNextCursor('<https://api.github.com/app/hook/deliveries?status=failure&cursor=1>; rel="next"'),
    ).toThrow();
    expect(parseNextCursor('<https://api.github.com/app/hook/deliveries?per_page=100&cursor=good>; rel="next"')).toBe(
      "good",
    );
  });
  it("counts failed attempts without calling recovered events lost", () => {
    const result = deliveryGapSummary(
      [delivery(1, guidA, 503), delivery(2, guidA, 202), delivery(3, guidB, 503), delivery(4, guidC, 502)],
      new Set([guidA, guidC]),
      true,
    );
    expect(result).toMatchObject({
      complete: true,
      attempts: 4,
      failedAttempts: 3,
      failedEvents: 3,
      failuresAlreadyStored: 2,
      failuresWithNoInbox: 1,
      unresolvedAfterSuccess: 0,
      needsReview: true,
    });
    expect(result.review).toEqual([{ deliveryId: 3, guid: guidB, category: "failed_not_stored" }]);
  });
  it("flags successful retries with no database record as review, not definite loss", () => {
    const result = deliveryGapSummary([delivery(1, guidA, 500), delivery(2, guidA, 204)], new Set(), true);
    expect(result.review).toEqual([{ deliveryId: 1, guid: guidA, category: "successful_retry_without_inbox" }]);
    expect(result.unresolvedAfterSuccess).toBe(1);
  });
  it("treats redirects as failed deliveries, even when a later attempt succeeds", () => {
    const result = deliveryGapSummary(
      [delivery(1, guidA, 302), delivery(2, guidA, 204), delivery(3, guidB, 301)],
      new Set(),
      true,
    );
    expect(result).toMatchObject({
      failedAttempts: 2,
      failedEvents: 2,
      failuresWithNoInbox: 1,
      unresolvedAfterSuccess: 1,
      needsReview: true,
    });
    expect(result.review).toEqual([
      { deliveryId: 1, guid: guidA, category: "successful_retry_without_inbox" },
      { deliveryId: 3, guid: guidB, category: "failed_not_stored" },
    ]);
  });
});
