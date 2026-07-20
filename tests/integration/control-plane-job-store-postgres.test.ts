import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ControlPlaneJobStore,
  createSqlControlPlaneJobStore,
} from "../../packages/db/src/control-plane-job-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
const testPrefix = `control-plane-test-${randomUUID()}`;

const action = {
  type: "installation.upsert" as const,
  installation: { id: 123, accountLogin: "octo", accountType: "Organization" },
};

function at(offsetSeconds: number): Date {
  return new Date(Date.now() + offsetSeconds * 1000);
}

function input(deliveryId: string, receivedAt: Date) {
  return {
    deliveryId,
    eventType: "installation",
    eventAction: "created",
    installationExternalId: 123,
    payloadSha256: "a".repeat(64),
    actions: [action],
    receivedAt,
  };
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function store(now: Date, options: { leaseSeconds?: number; maximumAttempts?: number } = {}): ControlPlaneJobStore {
  if (!executor) throw new Error("DATABASE_URL is required");
  return createSqlControlPlaneJobStore(executor, {
    now: () => now,
    leaseSeconds: options.leaseSeconds ?? 60,
    maximumAttempts: options.maximumAttempts ?? 3,
    retryBaseSeconds: 1,
  });
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from webhook_inbox where delivery_id like $1", [`${testPrefix}%`]);
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("control-plane PostgreSQL jobs", () => {
  it("atomically deduplicates concurrent deliveries into one inbox and one job", async () => {
    const now = at(0);
    const deliveryId = `${testPrefix}-duplicate`;
    const firstStore = store(now);
    const secondStore = store(now);

    const results = await Promise.all([
      firstStore.acceptGitHubWebhook(input(deliveryId, now)),
      secondStore.acceptGitHubWebhook(input(deliveryId, now)),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["accepted", "duplicate"]);
    const state = rows(
      await database().query(
        `select
           (select count(*)::int from webhook_inbox where provider = 'github' and delivery_id = $1) as inbox_count,
           (select count(*)::int from control_plane_jobs where inbox_id in (
             select id from webhook_inbox where provider = 'github' and delivery_id = $1
           )) as job_count,
           (select duplicate_count from webhook_inbox where provider = 'github' and delivery_id = $1) as duplicate_count`,
        [deliveryId],
      ),
    )[0];
    expect(state).toEqual({ inbox_count: 1, job_count: 1, duplicate_count: 1 });
  });

  it("claims accepted work through a newly constructed store after a process restart", async () => {
    const now = at(50);
    const deliveryId = `${testPrefix}-restart`;
    await store(now).acceptGitHubWebhook(input(deliveryId, now));

    const restartedStore = store(new Date(now.valueOf() + 1000));
    const claimed = await restartedStore.claimJobs({ workerId: `${testPrefix}-worker-restarted` });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ deliveryId, attemptCount: 1 });
  });

  it("allows only one worker to claim one available job", async () => {
    const now = at(100);
    const deliveryId = `${testPrefix}-claim`;
    await store(now).acceptGitHubWebhook(input(deliveryId, now));

    const [first, second] = await Promise.all([
      store(now).claimJobs({ workerId: `${testPrefix}-worker-a`, limit: 1 }),
      store(now).claimJobs({ workerId: `${testPrefix}-worker-b`, limit: 1 }),
    ]);

    expect([first.length, second.length].sort()).toEqual([0, 1]);
    const claimed = first[0] ?? second[0];
    expect(claimed).toMatchObject({ deliveryId, attemptCount: 1 });
  });

  it("keeps downstream outages retryable without losing accepted work", async () => {
    const acceptedAt = at(150);
    const deliveryId = `${testPrefix}-downstream-outage`;
    const workerId = `${testPrefix}-worker-outage`;
    await store(acceptedAt).acceptGitHubWebhook(input(deliveryId, acceptedAt));
    const claimed = await store(acceptedAt).claimJobs({ workerId });
    const job = claimed[0];
    if (!job) throw new Error("expected the outage test job to be claimed");

    await expect(
      store(acceptedAt).failJob({
        jobId: job.jobId,
        workerId,
        errorClass: "DownstreamUnavailable",
        errorMessage: "GitHub API unavailable",
      }),
    ).resolves.toBe("retry");
    await expect(store(acceptedAt).claimJobs({ workerId: `${workerId}-early` })).resolves.toEqual([]);

    const retry = await store(new Date(acceptedAt.valueOf() + 2000)).claimJobs({
      workerId: `${workerId}-retry`,
    });
    expect(retry[0]).toMatchObject({ deliveryId, attemptCount: 2 });
  });

  it("minimizes processed payloads and purges expired terminal inbox rows", async () => {
    const acceptedAt = at(175);
    const deliveryId = `${testPrefix}-retention`;
    const workerId = `${testPrefix}-worker-retention`;
    await store(acceptedAt).acceptGitHubWebhook(input(deliveryId, acceptedAt));
    const claimed = await store(acceptedAt).claimJobs({ workerId });
    const job = claimed[0];
    if (!job) throw new Error("expected the retention test job to be claimed");

    await expect(store(acceptedAt).completeJob({ jobId: job.jobId, workerId })).resolves.toBe("completed");
    const minimized = rows(
      await database().query("select state, normalized_actions from webhook_inbox where delivery_id = $1", [
        deliveryId,
      ]),
    )[0];
    expect(minimized).toEqual({ state: "processed", normalized_actions: [] });

    await database().query("update webhook_inbox set retention_until = $1 where delivery_id = $2", [
      new Date(acceptedAt.valueOf() - 1000).toISOString(),
      deliveryId,
    ]);
    await expect(store(acceptedAt).purgeExpired()).resolves.toBe(1);
    const remaining = rows(
      await database().query("select count(*)::int as count from webhook_inbox where delivery_id = $1", [deliveryId]),
    )[0];
    expect(remaining).toEqual({ count: 0 });
  });

  it("recovers an expired lease and dead-letters at the bounded attempt limit", async () => {
    const acceptedAt = at(200);
    const deliveryId = `${testPrefix}-expiry`;
    await store(acceptedAt, { leaseSeconds: 1, maximumAttempts: 2 }).acceptGitHubWebhook(input(deliveryId, acceptedAt));
    const first = await store(acceptedAt, { leaseSeconds: 1, maximumAttempts: 2 }).claimJobs({
      workerId: `${testPrefix}-worker-expired`,
    });
    expect(first[0]?.attemptCount).toBe(1);

    const recoveredAt = new Date(acceptedAt.valueOf() + 2000);
    const second = await store(recoveredAt, { leaseSeconds: 1, maximumAttempts: 2 }).claimJobs({
      workerId: `${testPrefix}-worker-recovery`,
    });
    expect(second[0]?.attemptCount).toBe(2);
    const recoveredJob = second[0];
    if (!recoveredJob) throw new Error("expected the expired job to be reclaimed");
    const outcome = await store(recoveredAt, { leaseSeconds: 1, maximumAttempts: 2 }).failJob({
      jobId: recoveredJob.jobId,
      workerId: `${testPrefix}-worker-recovery`,
      errorClass: "SyntheticFailure",
      errorMessage: "bounded failure",
    });
    expect(outcome).toBe("dead_letter");

    const state = rows(
      await database().query(
        `select wi.state as inbox_state, cpj.status as job_status, cpj.attempt_count
           from webhook_inbox wi
           join control_plane_jobs cpj on cpj.inbox_id = wi.id
          where wi.delivery_id = $1`,
        [deliveryId],
      ),
    )[0];
    expect(state).toEqual({ inbox_state: "dead_letter", job_status: "dead_letter", attempt_count: 2 });
  });

  it("rolls back the inbox when durable job creation violates its contract", async () => {
    const now = at(300);
    const deliveryId = `${testPrefix}-rollback`;

    await expect(
      database().query(
        `select * from boardreadyops_accept_github_webhook(
          $1, $2, 'github', $3, 'installation', 'created', 123, null, null,
          $4, $5::jsonb, $6::timestamptz, $7::timestamptz, 0
        )`,
        [
          randomUUID(),
          randomUUID(),
          deliveryId,
          "b".repeat(64),
          JSON.stringify([action]),
          now.toISOString(),
          new Date(now.valueOf() + 86_400_000).toISOString(),
        ],
      ),
    ).rejects.toThrow();

    const state = rows(
      await database().query("select count(*)::int as count from webhook_inbox where delivery_id = $1", [deliveryId]),
    )[0];
    expect(state).toEqual({ count: 0 });
  });
});
