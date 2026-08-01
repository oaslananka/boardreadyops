import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { BACKUP_RESTORE_CONFIRMATION, verifyPostgresBackupRestore } from "../../scripts/postgres-backup-restore.mjs";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const sourceUrl = getPostgresTestConnectionString();
const backupTestsEnabled = process.env.BOARDREADYOPS_BACKUP_RESTORE_TESTS === "true";
const describeBackup = sourceUrl && backupTestsEnabled ? describe : describe.skip;
const targetDatabase = `boardreadyops_restore_${randomBytes(6).toString("hex")}`;
const installationId = randomUUID();
const repositoryId = randomUUID();
const runId = randomUUID();
const attemptId = randomUUID();
const githubInstallationId = Number.parseInt(randomBytes(4).toString("hex"), 16) + 1;
const githubRepositoryId = Number.parseInt(randomBytes(4).toString("hex"), 16) + 1;

function databaseUrl(database: string) {
  if (!sourceUrl) throw new Error("DATABASE_URL is required");
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function sourceDatabaseName() {
  if (!sourceUrl) throw new Error("DATABASE_URL is required");
  return decodeURIComponent(new URL(sourceUrl).pathname.replace(/^\/+/, ""));
}

const restoreUrl = sourceUrl ? databaseUrl(targetDatabase) : undefined;
const adminUrl = sourceUrl ? databaseUrl("postgres") : undefined;
const source = sourceUrl ? createPgQueryExecutor({ connectionString: sourceUrl, max: 2 }) : undefined;
const admin = adminUrl ? createPgQueryExecutor({ connectionString: adminUrl, max: 1 }) : undefined;
let temporaryDirectory: string | undefined;
let targetCreated = false;

function sourceDatabase() {
  if (!source) throw new Error("source database is unavailable");
  return source;
}

function adminDatabase() {
  if (!admin) throw new Error("admin database is unavailable");
  return admin;
}

beforeAll(async () => {
  if (!sourceUrl || !restoreUrl || !backupTestsEnabled) return;
  temporaryDirectory = await mkdtemp(join(tmpdir(), "boardreadyops-backup-restore-"));
  await adminDatabase().query(`create database "${targetDatabase}" template template0`);
  targetCreated = true;
  await sourceDatabase().query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, 'backup-restore-fixture', 'Organization')`,
    [installationId, githubInstallationId],
  );
  await sourceDatabase().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, $3, 'backup-restore-fixture', 'control-plane', 'main', true)`,
    [repositoryId, installationId, githubRepositoryId],
  );
  await sourceDatabase().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status)
     values ($1, $2, $3, 'refs/heads/main', 222, 'pr', 'queued')`,
    [runId, repositoryId, "b".repeat(40)],
  );
  await sourceDatabase().query(
    `insert into release_run_attempts (id, run_id, attempt_number, status)
     values ($1, $2, 1, 'queued')`,
    [attemptId, runId],
  );
});

afterAll(async () => {
  if (!sourceUrl || !backupTestsEnabled) return;
  await sourceDatabase().query("delete from installations where id = $1", [installationId]);
  await source?.close();
  if (targetCreated) {
    await adminDatabase().query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [
      targetDatabase,
    ]);
    await adminDatabase().query(`drop database if exists "${targetDatabase}"`);
  }
  await admin?.close();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describeBackup("PostgreSQL backup and restore drill", () => {
  it("restores current schema and representative run state into an isolated empty database", async () => {
    if (!sourceUrl || !restoreUrl || !temporaryDirectory) throw new Error("backup restore fixture is unavailable");
    const backupPath = join(temporaryDirectory, "control-plane.dump");
    const result = await verifyPostgresBackupRestore({
      sourceUrl,
      restoreUrl,
      backupPath,
      confirmation: BACKUP_RESTORE_CONFIRMATION,
    });

    expect(result.event).toBe("postgres_backup_restore_verified");
    expect(result.backupBytes).toBeGreaterThan(0);
    expect(result.migrationCount).toBeGreaterThan(0);
    expect(result.publicTableCount).toBeGreaterThan(20);
    expect(result.representativeRows).toBeGreaterThanOrEqual(4);
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);

    const restored = createPgQueryExecutor({ connectionString: restoreUrl, max: 1 });
    try {
      await expect(
        restored.query(
          `select release_runs.status as run_status, release_run_attempts.status as attempt_status
               from release_runs
               join release_run_attempts on release_run_attempts.run_id = release_runs.id
              where release_runs.id = $1 and release_run_attempts.id = $2`,
          [runId, attemptId],
        ),
      ).resolves.toMatchObject({ rows: [{ run_status: "queued", attempt_status: "queued" }] });
      await expect(restored.query("select current_database() as database_name")).resolves.toMatchObject({
        rows: [{ database_name: targetDatabase }],
      });
      expect(targetDatabase).not.toBe(sourceDatabaseName());
    } finally {
      await restored.close();
    }
  }, 60_000);
});
