import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlAuditLogStore } from "../../packages/db/src/audit-log-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const prefix = `audit-export-${randomUUID()}`;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

async function createTenant(label: string) {
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const externalSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
     values ($1, $2::bigint, $3, 'Organization', 'enterprise')`,
    [installationId, externalSeed, `${prefix}-${label}`],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
     values ($1, $2, $3::bigint, $4, $5, false, 'main')`,
    [repositoryId, installationId, externalSeed + 1, prefix, label],
  );
  return { installationId, repositoryId };
}

async function cleanup() {
  if (!executor) return;
  await executor.query("delete from installations where account_login like $1", [`${prefix}%`]);
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("audit export PostgreSQL store", () => {
  it("keeps equal-timestamp pagination deterministic and installation scoped", async () => {
    const tenant = await createTenant("tenant-a");
    const other = await createTenant("tenant-b");
    const createdAt = "2026-07-28T02:00:00.000Z";
    const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const id of [firstId, secondId]) {
      await database().query(
        `insert into audit_events (
           id, installation_id, event_type, actor_type, actor_id,
           subject_type, subject_id, repository_id, metadata, created_at
         ) values ($1, $2, 'runner.result.persisted', 'runner', 'attempt-1',
                   'repository', $3, $3,
                   jsonb_build_object('status', 'completed', 'error', 'password=hidden'),
                   $4::timestamptz)`,
        [id, tenant.installationId, tenant.repositoryId, createdAt],
      );
    }

    const store = createSqlAuditLogStore(database());
    await expect(store.listAuditEvents({ installationId: other.installationId })).resolves.toEqual([]);

    const firstPage = await store.listAuditEvents({ installationId: tenant.installationId, limit: 1 });
    expect(firstPage).toEqual([
      expect.objectContaining({
        id: secondId,
        repositoryFullName: `${prefix}/tenant-a`,
        metadata: { status: "completed" },
        createdAt,
      }),
    ]);

    const secondPage = await store.listAuditEvents({
      installationId: tenant.installationId,
      limit: 1,
      cursor: { createdAt: new Date(firstPage[0]?.createdAt ?? ""), id: firstPage[0]?.id ?? "" },
    });
    expect(secondPage.map((item) => item.id)).toEqual([firstId]);
  });
});
