import { describe, expect, it } from "vitest";
import { runWebhookDeliveryAudit } from "../../../apps/web/scripts/audit-github-app-webhooks.mjs";
import { delivery, guidA, mockResponse, time } from "./github-app-webhook-delivery-audit-fixtures";

describe("GitHub App webhook delivery safety audit", () => {
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
  it("queries the inbox for a 3xx delivery rather than treating it as success", async () => {
    const lookedUp: string[][] = [];
    const report = await runWebhookDeliveryAudit(
      {
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: "test-only-key",
        DATABASE_URL: "postgresql://test-only:test-only@localhost/mock",
      },
      {
        now: () => Date.parse(time),
        authenticate: async () => ({ token: "test-only-jwt" }),
        request: async () => mockResponse([delivery(5, guidA, 302)]),
        lookupInbox: async (ids: string[]) => {
          lookedUp.push(ids);
          return new Set();
        },
      },
    );
    expect(lookedUp).toEqual([[guidA]]);
    expect(report).toMatchObject({ failedAttempts: 1, failuresWithNoInbox: 1, needsReview: true });
  });
});
