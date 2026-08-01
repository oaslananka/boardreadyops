import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRetentionMaintenanceStore } from "../../packages/db/src/retention-maintenance-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : undefined;
const testPrefix = `history-retention-${randomUUID()}`;
const now = new Date("2026-08-01T08:00:00.000Z");
const githubInstallationId = randomBytes(6).readUIntBE(0, 6) + 1;
const githubRepositoryId = randomBytes(6).readUIntBE(0, 6) + 1;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function cleanup(): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where account_login like $1", [`${testPrefix}%`]);
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await executor?.close();
});

describeDatabase("completed control-plane history retention", () => {
  it("purges only eligible completed history and preserves active or investigative state", async () => {
    const installationId = randomUUID();
    const repositoryId = randomUUID();
    const runId = randomUUID();
    const oldCompletedOutboxId = randomUUID();
    const activeReferencedOutboxId = randomUUID();
    const recentCompletedOutboxId = randomUUID();
    const deadLetterReferencedOutboxId = randomUUID();
    const deadLetterOutboxId = randomUUID();
    const oldCompletedReconciliationId = randomUUID();
    const activeReconciliationId = randomUUID();
    const deadLetterReconciliationId = randomUUID();
    const deadLetterOutboxReconciliationId = randomUUID();
    const oldAt = "2026-04-01T08:00:00.000Z";
    const recentAt = "2026-07-20T08:00:00.000Z";

    await database().query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, $2, $3, 'Organization')`,
      [installationId, githubInstallationId, `${testPrefix}-tenant`],
    );
    await database().query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
       values ($1, $2, $3, 'retention', 'fixture', 'main', false)`,
      [repositoryId, installationId, githubRepositoryId],
    );
    await database().query(
      `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at)
       values ($1, $2, $3, 'refs/heads/main', 'push', 'queued', $4::timestamptz)`,
      [runId, repositoryId, "a".repeat(40), oldAt],
    );

    for (const [id, status, completedAt] of [
      [oldCompletedOutboxId, "completed", oldAt],
      [activeReferencedOutboxId, "completed", oldAt],
      [recentCompletedOutboxId, "completed", recentAt],
      [deadLetterReferencedOutboxId, "completed", oldAt],
      [deadLetterOutboxId, "dead_letter", oldAt],
    ] as const) {
      await database().query(
        `insert into control_plane_outbox (
           id, release_run_id, effect_type, idempotency_key, payload, status,
           available_at, attempt_count, max_attempts, created_at, completed_at
         ) values (
           $1, $2, 'github.check_run.create', $3,
           jsonb_build_object('version', 1, 'type', 'github.check_run.create'),
           $4, $5::timestamptz, 1, 8, $5::timestamptz, $5::timestamptz
         )`,
        [id, runId, `${testPrefix}:${id}`, status, completedAt],
      );
    }

    await database().query(
      `insert into control_plane_reconciliation_items (
         id, installation_id, repository_id, release_run_id, subject_type, subject_id,
         reason_code, status, deadline_at, next_check_at, created_at
       ) values (
         $1, $2, $3, $4, 'outbox', $5, 'delivery_uncertain', 'available',
         $6::timestamptz, $6::timestamptz, $7::timestamptz
       )`,
      [activeReconciliationId, installationId, repositoryId, runId, activeReferencedOutboxId, recentAt, oldAt],
    );
    await database().query(
      `insert into control_plane_reconciliation_items (
         id, installation_id, repository_id, release_run_id, subject_type, subject_id,
         reason_code, status, deadline_at, next_check_at, created_at, completed_at, outcome_code
       ) values (
         $1, $2, $3, $4, 'release_run', $4, 'reporting_stale', 'completed',
         $5::timestamptz, $5::timestamptz, $5::timestamptz, $5::timestamptz, 'already_published'
       )`,
      [oldCompletedReconciliationId, installationId, repositoryId, runId, oldAt],
    );
    await database().query(
      `insert into control_plane_reconciliation_items (
         id, installation_id, repository_id, release_run_id, subject_type, subject_id,
         reason_code, status, deadline_at, next_check_at, created_at, completed_at, outcome_code
       ) values (
         $1, $2, $3, $4, 'release_run', $4, 'reporting_stale', 'dead_letter',
         $5::timestamptz, $5::timestamptz, $5::timestamptz, $5::timestamptz, 'retry_exhausted'
       )`,
      [deadLetterReconciliationId, installationId, repositoryId, runId, oldAt],
    );

    await database().query(
      `insert into control_plane_reconciliation_items (
         id, installation_id, repository_id, release_run_id, subject_type, subject_id,
         reason_code, status, deadline_at, next_check_at, created_at, completed_at, outcome_code
       ) values (
         $1, $2, $3, $4, 'outbox', $5, 'delivery_uncertain', 'dead_letter',
         $6::timestamptz, $6::timestamptz, $6::timestamptz, $6::timestamptz, 'retry_exhausted'
       )`,
      [deadLetterOutboxReconciliationId, installationId, repositoryId, runId, deadLetterReferencedOutboxId, oldAt],
    );

    const retention = createSqlRetentionMaintenanceStore(database(), { now: () => now });
    await expect(retention.purgeCompletedControlPlaneOutbox({ retentionDays: 90 })).resolves.toBe(1);
    await expect(retention.purgeCompletedControlPlaneReconciliationItems({ retentionDays: 90 })).resolves.toBe(1);

    const outboxState = rows(
      await database().query(
        `select id, status from control_plane_outbox
          where id = any($1::text[]) order by id`,
        [
          [
            oldCompletedOutboxId,
            activeReferencedOutboxId,
            recentCompletedOutboxId,
            deadLetterReferencedOutboxId,
            deadLetterOutboxId,
          ],
        ],
      ),
    );
    expect(outboxState).toEqual(
      [
        { id: activeReferencedOutboxId, status: "completed" },
        { id: recentCompletedOutboxId, status: "completed" },
        { id: deadLetterReferencedOutboxId, status: "completed" },
        { id: deadLetterOutboxId, status: "dead_letter" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const reconciliationState = rows(
      await database().query(
        `select id, status from control_plane_reconciliation_items
          where id = any($1::text[]) order by id`,
        [
          [
            oldCompletedReconciliationId,
            activeReconciliationId,
            deadLetterReconciliationId,
            deadLetterOutboxReconciliationId,
          ],
        ],
      ),
    );
    expect(reconciliationState).toEqual(
      [
        { id: activeReconciliationId, status: "available" },
        { id: deadLetterReconciliationId, status: "dead_letter" },
        { id: deadLetterOutboxReconciliationId, status: "dead_letter" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    await database().query("delete from control_plane_reconciliation_items where id = $1", [activeReconciliationId]);
    await expect(retention.purgeCompletedControlPlaneOutbox({ retentionDays: 90 })).resolves.toBe(1);
    await expect(
      database().query("select count(*)::int as count from release_runs where id = $1", [runId]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});
