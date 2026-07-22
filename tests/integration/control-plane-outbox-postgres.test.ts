import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ControlPlaneOutboxEffectType,
  type ControlPlaneOutboxPayload,
  createSqlControlPlaneOutboxStore,
} from "../../packages/db/src/control-plane-outbox-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 8 }) : undefined;
const testPrefix = `outbox-test-${randomUUID()}`;

const action = {
  type: "release_run.enqueue" as const,
  installation: { id: 123 },
  repository: {
    id: 456,
    owner: "octo",
    name: "repo",
    fullName: "octo/repo",
    private: false,
    defaultBranch: "main",
  },
  commitSha: "a".repeat(40),
  ref: "refs/pull/1/head",
  pullRequestNumber: 1,
  pullRequestDraft: false,
  pullRequestFromFork: false,
  triggerKind: "pr" as const,
};

function at(offsetSeconds: number): Date {
  return new Date(Date.now() + offsetSeconds * 1000);
}

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function store(now: Date, leaseSeconds = 60) {
  return createSqlControlPlaneOutboxStore(database(), {
    now: () => now,
    leaseSeconds,
    retryBaseSeconds: 1,
  });
}

function payload(effectType: ControlPlaneOutboxEffectType, id: string): ControlPlaneOutboxPayload {
  if (effectType === "github.check_run.create") {
    return {
      version: 1,
      type: effectType,
      action,
      runId: `run-${id}`,
      idempotencyKey: `release-${id}`,
    };
  }
  if (effectType === "github.check_run.complete") {
    return {
      version: 1,
      type: effectType,
      input: {
        installationId: 123,
        repositoryOwner: "octo",
        repositoryName: "repo",
        checkRunId: 789,
        runId: `run-${id}`,
        conclusion: "success",
        title: "ready",
        summary: "ready",
      },
    };
  }
  return {
    version: 1,
    type: effectType,
    input: {
      action,
      runId: `run-${id}`,
      idempotencyKey: `release-${id}`,
      githubCheckRunId: 789,
      executionAttemptId: randomUUID(),
    },
  };
}

async function insertEffect(
  input: {
    effectType?: ControlPlaneOutboxEffectType;
    status?: "available" | "leased";
    attemptCount?: number;
    maxAttempts?: number;
    leaseOwner?: string;
    leaseExpiresAt?: Date;
    deliveryStartedAt?: Date;
    availableAt?: Date;
  } = {},
): Promise<string> {
  const id = `${testPrefix}-${randomUUID()}`;
  const effectType = input.effectType ?? "github.check_run.create";
  const status = input.status ?? "available";
  const now = input.availableAt ?? at(0);
  await database().query(
    `insert into control_plane_outbox (
       id, effect_type, payload_version, idempotency_key, payload, priority,
       status, available_at, attempt_count, max_attempts, lease_owner,
       lease_expires_at, created_at, delivery_started_at
     ) values (
       $1, $2, 1, $3, $4::jsonb, 100,
       $5, $6::timestamptz, $7, $8, $9,
       $10::timestamptz, $11::timestamptz, $12::timestamptz
     )`,
    [
      id,
      effectType,
      `${testPrefix}:${id}`,
      JSON.stringify(payload(effectType, id)),
      status,
      now.toISOString(),
      input.attemptCount ?? 0,
      input.maxAttempts ?? 8,
      status === "leased" ? (input.leaseOwner ?? `${testPrefix}-old-worker`) : null,
      status === "leased" ? (input.leaseExpiresAt ?? at(60)).toISOString() : null,
      now.toISOString(),
      input.deliveryStartedAt?.toISOString() ?? null,
    ],
  );
  return id;
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from control_plane_outbox where id like $1", [`${testPrefix}%`]);
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("control-plane PostgreSQL transactional outbox", () => {
  it("allows only one worker to claim one available effect", async () => {
    const now = at(10);
    const outboxId = await insertEffect({ availableAt: now });

    const [first, second] = await Promise.all([
      store(now).claimEffects({ workerId: `${testPrefix}-worker-a`, limit: 1 }),
      store(now).claimEffects({ workerId: `${testPrefix}-worker-b`, limit: 1 }),
    ]);

    expect([first.length, second.length].sort()).toEqual([0, 1]);
    expect((first[0] ?? second[0])?.outboxId).toBe(outboxId);
  });

  it("recovers an expired idempotent lease and rejects stale completion", async () => {
    const expiredAt = at(20);
    const recoveryAt = new Date(expiredAt.valueOf() + 2000);
    const outboxId = await insertEffect({
      status: "leased",
      attemptCount: 1,
      leaseOwner: `${testPrefix}-expired-worker`,
      leaseExpiresAt: new Date(expiredAt.valueOf() + 1000),
      availableAt: expiredAt,
    });

    const recovered = await store(recoveryAt).claimEffects({ workerId: `${testPrefix}-recovery-worker` });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ outboxId, attemptCount: 2 });
    await expect(
      store(recoveryAt).completeEffect({
        outboxId,
        workerId: `${testPrefix}-expired-worker`,
      }),
    ).resolves.toBe("stale");
    await expect(
      store(recoveryAt).completeEffect({
        outboxId,
        workerId: `${testPrefix}-recovery-worker`,
        externalResult: { githubCheckRunId: 789 },
      }),
    ).resolves.toBe("completed");
  });

  it("quarantines an uncertain workflow dispatch instead of replaying it", async () => {
    const leasedAt = at(30);
    const recoveryAt = new Date(leasedAt.valueOf() + 2000);
    const outboxId = await insertEffect({
      effectType: "github.workflow.dispatch",
      status: "leased",
      attemptCount: 1,
      leaseOwner: `${testPrefix}-dispatch-worker`,
      leaseExpiresAt: new Date(leasedAt.valueOf() + 1000),
      deliveryStartedAt: leasedAt,
      availableAt: leasedAt,
    });

    await expect(store(recoveryAt).claimEffects({ workerId: `${testPrefix}-recovery-worker` })).resolves.toEqual([]);
    const state = rows(
      await database().query(
        "select status, completed_at is not null as terminal from control_plane_outbox where id = $1",
        [outboxId],
      ),
    )[0];
    expect(state).toEqual({ status: "reconciliation_required", terminal: true });
    await expect(store(recoveryAt).replayEffect({ outboxId })).resolves.toBe("not_replayable");
  });

  it("dead-letters at the bounded attempt limit and supports explicit replay", async () => {
    const now = at(40);
    const outboxId = await insertEffect({ maxAttempts: 1, availableAt: now });
    const claimed = await store(now).claimEffects({ workerId: `${testPrefix}-worker` });
    expect(claimed[0]?.attemptCount).toBe(1);

    await expect(
      store(now).failEffect({
        outboxId,
        workerId: `${testPrefix}-worker`,
        attemptCount: 1,
        errorClass: "SyntheticFailure",
        errorMessage: "bounded failure",
      }),
    ).resolves.toBe("dead_letter");
    await expect(store(now).replayEffect({ outboxId })).resolves.toBe("replayed");
    await expect(
      store(new Date(now.valueOf() + 1000)).claimEffects({ workerId: `${testPrefix}-replayed-worker` }),
    ).resolves.toHaveLength(1);
  });

  it("rolls back an outbox write with its surrounding statement", async () => {
    const id = `${testPrefix}-${randomUUID()}`;
    await expect(
      database().query(
        `with inserted as (
           insert into control_plane_outbox (
             id, effect_type, idempotency_key, payload, available_at, created_at
           ) values ($1, 'github.check_run.create', $2, $3::jsonb, now(), now())
           returning id
         )
         select 1 / 0 from inserted`,
        [id, `${testPrefix}:${id}`, JSON.stringify(payload("github.check_run.create", id))],
      ),
    ).rejects.toThrow();

    const result = rows(
      await database().query("select count(*)::int as count from control_plane_outbox where id = $1", [id]),
    )[0];
    expect(result).toEqual({ count: 0 });
  });
});
