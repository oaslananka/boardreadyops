import { describe, expect, it } from "vitest";
import {
  deliveryGapSummary,
  fetchRecentAppWebhookDeliveries,
} from "../../../apps/web/scripts/audit-github-app-webhooks.mjs";
import { delivery, guidA, mockResponse, time } from "./github-app-webhook-delivery-audit-fixtures";

describe("GitHub App webhook delivery safety audit", () => {
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
