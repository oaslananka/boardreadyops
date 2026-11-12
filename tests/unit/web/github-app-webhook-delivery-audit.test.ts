import { describe, expect, it } from "vitest";
import {
  auditOptions,
  deliveryGapSummary,
  fetchRecentAppWebhookDeliveries,
  parseNextCursor,
  runWebhookDeliveryAudit,
} from "../../../apps/web/scripts/audit-github-app-webhooks.mjs";

const time = "2026-11-12T06:00:00Z";
const guidA = "00000000-0000-4000-8000-000000000001";
const guidB = "00000000-0000-4000-8000-000000000002";
const guidC = "00000000-0000-4000-8000-000000000003";
function delivery(id: number, guid: string, code: number, at = time) {
  return {
    id,
    guid,
    statusCode: code,
    status_code: code,
    status: code >= 200 && code < 400 ? "OK" : "failed",
    delivered_at: at,
  };
}
function mockResponse(rows: unknown[], next?: string) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { ...(next ? { link: "<" + next + '>; rel="next"' } : {}), "content-type": "application/json" },
  });
}
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
  it("fails closed when pagination is incomplete or malformed", async () => {
    const request = async () =>
      mockResponse([delivery(1, guidA, 502)], "https://api.github.com/app/hook/deliveries?per_page=100&cursor=more");
    const result = await fetchRecentAppWebhookDeliveries({
      token: "test-only",
      since: "2026-11-11T06:00:00Z",
      maxPages: 1,
      request,
    });
    expect(result.complete).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(deliveryGapSummary(result.attempts, new Set(), result.complete).needsReview).toBe(true);
    await expect(
      fetchRecentAppWebhookDeliveries({
        token: "test-only",
        since: time,
        maxPages: 1,
        request: async () => mockResponse([{ bad: true }]),
      }),
    ).rejects.toThrow();
  });
  it("collects cursor pages, rejects redirects and never mutates", async () => {
    const seen: Array<{ url: string; method?: string; redirect?: string }> = [];
    const responses = [
      mockResponse([delivery(1, guidA, 502)], "https://api.github.com/app/hook/deliveries?per_page=100&cursor=second"),
      mockResponse([delivery(2, guidA, 202)]),
    ];
    const result = await fetchRecentAppWebhookDeliveries({
      token: "test-only",
      since: "2026-11-11T06:00:00Z",
      maxPages: 2,
      request: async (url: string, init: RequestInit) => {
        seen.push({ url, method: init.method, redirect: init.redirect });
        const response = responses.shift();
        if (!response) throw new Error("fixture exhausted");
        return response;
      },
    });
    expect(result.complete).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(seen.map((x) => x.method)).toEqual(["GET", "GET"]);
    expect(seen.map((x) => x.redirect)).toEqual(["error", "error"]);
    expect(seen[1]?.url).toContain("cursor=second");
  });
  it("performs app-auth and read-only DB lookup with no exposed credential or payload", async () => {
    const requested: string[] = [];
    const report = await runWebhookDeliveryAudit(
      {
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: "sensitive-private-key-for-mock",
        DATABASE_URL: "postgresql://test-only:test-only@localhost/mock",
      },
      {
        now: () => Date.parse(time),
        authenticate: async ({ type }: { type: string }) => {
          expect(type).toBe("app");
          return { token: "fake-jwt-token" };
        },
        request: async (url: string, init: RequestInit) => {
          requested.push(init.method || "");
          expect(url).toContain("/app/hook/deliveries");
          expect((init.headers as Record<string, string>).authorization).toBe("Bearer fake-jwt-token");
          return mockResponse([delivery(5, guidA, 500)]);
        },
        lookupInbox: async (ids: string[]) => {
          expect(ids).toEqual([guidA]);
          return new Set([guidA]);
        },
      },
    );
    expect(requested).toEqual(["GET"]);
    expect(report).toMatchObject({ complete: true, failuresAlreadyStored: 1, needsReview: false });
    expect(JSON.stringify(report)).not.toContain("sensitive-private-key-for-mock");
    expect(JSON.stringify(report)).not.toContain("fake-jwt-token");
  });
  it("rejects failed GitHub lookup and malformed data as an audit failure", async () => {
    await expect(
      fetchRecentAppWebhookDeliveries({
        token: "fake",
        since: time,
        request: async () => new Response("no", { status: 403 }),
      }),
    ).rejects.toThrow("github_delivery_request_failed_403");
    await expect(
      fetchRecentAppWebhookDeliveries({
        token: "fake",
        since: time,
        request: async () => mockResponse([delivery(1, guidA, 700)]),
      }),
    ).rejects.toThrow("invalid_github_delivery");
  });

  it("does not count deliveries outside the requested window", async () => {
    const result = await fetchRecentAppWebhookDeliveries({
      token: "test-only",
      since: "2026-11-11T06:00:00Z",
      maxPages: 2,
      request: async () => mockResponse([delivery(1, guidA, 503, "2026-11-09T00:00:00Z")]),
    });
    expect(result.attempts).toEqual([]);
    expect(result.complete).toBe(true);
  });
});
