import { describe, expect, it } from "vitest";
import {
  createMemoryControlPlaneJobStore,
  createSqlControlPlaneJobStore,
} from "../../../packages/db/src/control-plane-job-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const action = {
  type: "installation.upsert" as const,
  installation: { id: 123, accountLogin: "octo", accountType: "Organization" },
};

function webhook(deliveryId = "delivery-1") {
  return {
    deliveryId,
    eventType: "installation",
    eventAction: "created",
    installationExternalId: 123,
    payloadSha256: "a".repeat(64),
    actions: [action],
  };
}

describe("control-plane job store", () => {
  it("deduplicates accepted deliveries in memory", async () => {
    const ids = ["inbox-1", "job-1"];
    const store = createMemoryControlPlaneJobStore({ id: () => ids.shift() ?? "unexpected" });

    await expect(store.acceptGitHubWebhook(webhook())).resolves.toEqual({
      outcome: "accepted",
      inboxId: "inbox-1",
      jobId: "job-1",
      queued: true,
    });
    await expect(store.acceptGitHubWebhook(webhook())).resolves.toEqual({
      outcome: "duplicate",
      inboxId: "inbox-1",
      jobId: "job-1",
      queued: false,
    });
  });

  it("passes only normalized actions and routing metadata into the atomic SQL intake", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return { rows: [{ outcome: "accepted", inbox_id: "inbox-1", job_id: "job-1" }] };
      },
    };
    const ids = ["inbox-1", "job-1"];
    const store = createSqlControlPlaneJobStore(executor, {
      id: () => ids.shift() ?? "unexpected",
      now: () => new Date("2026-07-20T20:00:00.000Z"),
      retentionDays: 90,
    });

    await expect(store.acceptGitHubWebhook(webhook())).resolves.toMatchObject({
      outcome: "accepted",
      queued: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("boardreadyops_accept_github_webhook");
    expect(calls[0]?.params).toContain(JSON.stringify([action]));
    expect(calls[0]?.params?.[11]).toBe("2026-10-18T20:00:00.000Z");
    expect(calls[0]?.params).not.toContain("GITHUB_WEBHOOK_SECRET");
  });

  it("collects aggregate queue metrics without tenant identifiers", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql) {
        expect(sql).toContain("oldest_unprocessed_age_seconds");
        return {
          rows: [
            {
              available_jobs: 4,
              leased_jobs: 2,
              dead_letter_jobs: 1,
              duplicate_deliveries: 7,
              enqueue_failures: 0,
              oldest_unprocessed_age_seconds: 83,
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneJobStore(executor);

    await expect(store.collectMetrics()).resolves.toEqual({
      availableJobs: 4,
      leasedJobs: 2,
      deadLetterJobs: 1,
      duplicateDeliveries: 7,
      oldestUnprocessedAgeSeconds: 83,
    });
  });

  it("purges expired terminal records through a bounded SQL function", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_purge_expired_webhook_inbox");
        expect(params?.[1]).toBe(10_000);
        return { rows: [{ purged: 12 }] };
      },
    };
    const store = createSqlControlPlaneJobStore(executor, {
      now: () => new Date("2026-07-20T20:00:00.000Z"),
    });

    await expect(store.purgeExpired({ limit: 50_000 })).resolves.toBe(12);
  });

  it("claims bounded jobs with a worker lease", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql) {
        expect(sql).toContain("boardreadyops_claim_control_plane_jobs");
        return {
          rows: [
            {
              job_id: "job-1",
              inbox_id: "inbox-1",
              job_type: "github_webhook.lifecycle",
              payload_version: 1,
              attempt_count: 2,
              event_type: "installation",
              event_action: "created",
              delivery_id: "delivery-1",
              normalized_actions: [action],
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneJobStore(executor, {
      now: () => new Date("2026-07-20T20:00:00.000Z"),
    });

    await expect(store.claimJobs({ workerId: "worker-1", limit: 4 })).resolves.toEqual([
      {
        jobId: "job-1",
        inboxId: "inbox-1",
        jobType: "github_webhook.lifecycle",
        payloadVersion: 1,
        attemptCount: 2,
        eventType: "installation",
        eventAction: "created",
        deliveryId: "delivery-1",
        actions: [action],
      },
    ]);
  });
});
