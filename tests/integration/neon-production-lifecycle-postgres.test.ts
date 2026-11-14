import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createProductionNeonLifecycleHandler } from "../../apps/web/lib/neon-production-lifecycle.js";
import { createSqlControlPlaneJobStore } from "../../packages/db/src/control-plane-job-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const prefix = `neon-lifecycle-${randomUUID()}`;
const triggerId = "trigger-1a2b3c4d-5e6f-7890-abcd-ef1234567890";
const invocationId = "abc123FUPHOw0Pl1ZooidgpJhvHaShi1aX40cQ0b321";

function request(): Request {
  return new Request("https://example.neon.tech/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-neon-trigger-invocation-id": invocationId,
    },
    body: JSON.stringify({
      version: 1,
      invocation_id: invocationId,
      trigger: { type: "schedule", id: triggerId, name: "lifecycle" },
      data: { scheduled_at: "2026-11-14T17:00:00Z" },
    }),
  });
}

afterAll(async () => {
  if (executor) {
    await executor.query("delete from webhook_inbox where delivery_id like $1", [`${prefix}%`]);
    await executor.close();
  }
});

describeDb("Neon scheduled lifecycle Function with actual PostgreSQL durable queue", () => {
  it("processes an accepted stored lifecycle event exactly once through canonical job handling", async () => {
    if (!executor || !connectionString) throw new Error("disposable PostgreSQL is required");
    const jobs = createSqlControlPlaneJobStore(executor);
    const deliveryId = `${prefix}-installation-created`;
    const installationId = Math.floor(Math.random() * 900_000_000) + 100_000_000;
    const accepted = await jobs.acceptGitHubWebhook({
      deliveryId,
      eventType: "installation",
      eventAction: "created",
      installationExternalId: installationId,
      payloadSha256: "b".repeat(64),
      actions: [
        {
          type: "installation.upsert",
          installation: {
            id: installationId,
            accountLogin: `neon-test-${installationId}`,
            accountType: "Organization",
          },
        },
      ],
    });
    expect(accepted.queued).toBe(true);
    const handler = createProductionNeonLifecycleHandler({
      triggerId,
      connectionString,
      workerConnectionString: connectionString,
      workerId: `${prefix}-worker`,
      batchLimit: 1,
      environment: {
        GITHUB_APP_ID: "1234",
        GITHUB_APP_PRIVATE_KEY: "test-only-unused-key",
      },
    });
    expect((await handler(request())).status).toBe(200);
    const row = await executor.query(
      "select cpj.status from control_plane_jobs cpj join webhook_inbox wi on wi.id=cpj.inbox_id where wi.delivery_id=$1",
      [deliveryId],
    );
    expect((row as { rows: { status: string }[] }).rows[0]?.status).toBe("completed");
    expect((await handler(request())).status).toBe(200);
    const duplicate = await executor.query(
      "select cpj.status, cpj.attempt_count from control_plane_jobs cpj join webhook_inbox wi on wi.id=cpj.inbox_id where wi.delivery_id=$1",
      [deliveryId],
    );
    expect((duplicate as { rows: { status: string; attempt_count: number }[] }).rows[0]).toMatchObject({
      status: "completed",
      attempt_count: 1,
    });
  });
});
