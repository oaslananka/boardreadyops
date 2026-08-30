import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRetentionMaintenanceStore } from "../../packages/db/src/retention-maintenance-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const testPrefix = `artifact-retention-preview-${randomUUID()}`;
const now = new Date("2026-08-30T12:00:00.000Z");

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function githubId(): number {
  return randomBytes(6).readUIntBE(0, 6) + 1;
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from legal_holds where tenant_id like $1", [`${testPrefix}%`]);
  await executor.query("delete from retention_policies where tenant_id like $1", [`${testPrefix}%`]);
  await executor.query("delete from installations where account_login like $1", [`${testPrefix}%`]);
}
type FixtureInput = {
  suffix: string;
  tier: "free" | "team" | "business";
  ageDays: number;
  policyDays?: number;
  retentionUntil?: string;
  legalHold?: boolean;
};

async function createArtifactFixture(input: FixtureInput): Promise<string> {
  const installationId = randomUUID();
  const repositoryId = randomUUID();
  const runId = randomUUID();
  const artifactId = randomUUID();
  const tenantId = `${testPrefix}-${input.suffix}`;
  const uploadedAt = new Date(now.getTime() - input.ageDays * 86_400_000).toISOString();

  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
     values ($1, $2, $3, 'Organization', $4)`,
    [installationId, githubId(), tenantId, input.tier],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, $3, $4, $5, 'main', false)`,
    [repositoryId, installationId, githubId(), tenantId, "fixture"],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at)
     values ($1, $2, $3, 'refs/heads/main', 'push', 'completed', $4::timestamptz)`,
    [runId, repositoryId, "a".repeat(40), uploadedAt],
  );
  await database().query(
    `insert into artifacts (id, run_id, kind, name, storage_path, sha256, bytes, role, uploaded_at, retention_until)
     values ($1, $2, 'report', 'report.json', $3, $4, 1, 'report', $5::timestamptz, $6::timestamptz)`,
    [artifactId, runId, `${tenantId}/${artifactId}`, "b".repeat(64), uploadedAt, input.retentionUntil ?? null],
  );

  if (input.policyDays !== undefined) {
    await database().query(
      `insert into retention_policies (id, tenant_id, tier, retention_days)
       values ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, input.tier, input.policyDays],
    );
  }

  if (input.legalHold) {
    await database().query(
      `insert into legal_holds (id, tenant_id, created_by, reason, scope)
       values ($1, $2, 'test', 'Retention preview integration hold', 'organization')`,
      [randomUUID(), tenantId],
    );
  }
  return artifactId;
}
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("artifact retention preview", () => {
  it("prioritizes persisted deadlines, then plan policy, while tenant legal holds suppress both", async () => {
    const artifactIds = await Promise.all([
      createArtifactFixture({ suffix: "free-old", tier: "free", ageDays: 31 }),
      createArtifactFixture({ suffix: "free-recent", tier: "free", ageDays: 29 }),
      createArtifactFixture({ suffix: "team-old", tier: "team", ageDays: 366 }),
      createArtifactFixture({ suffix: "team-recent", tier: "team", ageDays: 100 }),
      createArtifactFixture({ suffix: "business-unbounded", tier: "business", ageDays: 800 }),
      createArtifactFixture({ suffix: "business-policy", tier: "business", ageDays: 11, policyDays: 10 }),
      createArtifactFixture({
        suffix: "business-persisted-expired",
        tier: "business",
        ageDays: 1,
        retentionUntil: "2026-08-29T12:00:00.000Z",
      }),
      createArtifactFixture({
        suffix: "free-persisted-future",
        tier: "free",
        ageDays: 90,
        retentionUntil: "2026-09-01T12:00:00.000Z",
      }),
      createArtifactFixture({ suffix: "free-held", tier: "free", ageDays: 90, legalHold: true }),
      createArtifactFixture({
        suffix: "business-persisted-held",
        tier: "business",
        ageDays: 1,
        retentionUntil: "2026-08-29T12:00:00.000Z",
        legalHold: true,
      }),
    ]);

    const store = createSqlRetentionMaintenanceStore(database(), { now: () => now, defaultBatchSize: 100 });
    await expect(store.previewExpiredArtifactRetention()).resolves.toBe(4);

    const result = await database().query("select count(*)::int as count from artifacts where id = any($1::text[])", [
      artifactIds,
    ]);
    expect(result).toMatchObject({ rows: [{ count: artifactIds.length }] });
  });
});
