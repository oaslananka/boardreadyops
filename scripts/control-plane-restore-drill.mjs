import { randomBytes, randomUUID } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  BACKUP_RESTORE_CONFIRMATION,
  databaseIdentity,
  verifyPostgresBackupRestore,
} from "./postgres-backup-restore.mjs";

const { Pool } = pg;

export const RESTORE_DRILL_CONFIRMATION = "isolated-disposable-database";

function createExecutor(connectionString) {
  const pool = new Pool({ connectionString, max: 2 });
  return {
    query: (sql, params = []) => pool.query(sql, [...params]),
    close: () => pool.end(),
  };
}

async function backupPathExists(backupPath) {
  try {
    await lstat(backupPath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw new Error("restore drill backup path could not be inspected");
  }
}

export function buildPostgresRestoreDrillPlan({ sourceUrl, restoreUrl, backupPath, confirmation }) {
  if (confirmation !== RESTORE_DRILL_CONFIRMATION) {
    throw new Error("isolated disposable restore drill confirmation is required");
  }
  if (!path.isAbsolute(backupPath)) {
    throw new Error("restore drill backup path must be absolute");
  }
  const sourceIdentity = databaseIdentity(sourceUrl);
  const restoreIdentity = databaseIdentity(restoreUrl);
  if (sourceIdentity === restoreIdentity) {
    throw new Error("restore drill target database must differ from the source database");
  }
  return { sourceIdentity, restoreIdentity, backupPath };
}

export function summarizePostgresRestoreDrill({ backup, restoredRunStateVerified }) {
  if (!restoredRunStateVerified) {
    throw new Error("representative restored run state was not verified");
  }
  return {
    event: "postgres_restore_readiness_verified",
    backupBytes: backup.backupBytes,
    migrationCount: backup.migrationCount,
    publicTableCount: backup.publicTableCount,
    representativeRows: backup.representativeRows,
    restoredRunStateVerified: true,
  };
}

async function assertDisposableSource(executor) {
  const result = await executor.query(`
    select
      (select count(*)::int from installations) as installations,
      (select count(*)::int from repositories) as repositories,
      (select count(*)::int from release_runs) as release_runs,
      (select count(*)::int from webhook_inbox) as webhook_inbox,
      (select count(*)::int from control_plane_jobs) as control_plane_jobs,
      (select count(*)::int from control_plane_outbox) as control_plane_outbox
  `);
  const row = result.rows[0] ?? {};
  const occupied = Object.values(row).some((value) => Number(value) !== 0);
  if (occupied) {
    throw new Error("restore drill source database must be disposable and empty");
  }
}

async function seedRepresentativeRun(executor, fixture) {
  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, 'restore-drill-fixture', 'Organization')`,
    [fixture.installationId, fixture.githubInstallationId],
  );
  await executor.query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch, private)
     values ($1, $2, $3, 'restore-drill-fixture', 'control-plane', 'main', true)`,
    [fixture.repositoryId, fixture.installationId, fixture.githubRepositoryId],
  );
  await executor.query(
    `insert into release_runs (id, repository_id, commit_sha, ref, pull_request_number, trigger_kind, status)
     values ($1, $2, $3, 'refs/heads/main', 222, 'pr', 'queued')`,
    [fixture.runId, fixture.repositoryId, "b".repeat(40)],
  );
  await executor.query(
    `insert into release_run_attempts (id, run_id, attempt_number, status)
     values ($1, $2, 1, 'queued')`,
    [fixture.attemptId, fixture.runId],
  );
}

function fixtureIds() {
  return {
    installationId: randomUUID(),
    repositoryId: randomUUID(),
    runId: randomUUID(),
    attemptId: randomUUID(),
    githubInstallationId: Number.parseInt(randomBytes(4).toString("hex"), 16) + 1,
    githubRepositoryId: Number.parseInt(randomBytes(4).toString("hex"), 16) + 1,
  };
}

export async function runPostgresRestoreDrill(input, dependencies = {}) {
  buildPostgresRestoreDrillPlan(input);
  const makeExecutor = dependencies.createExecutor ?? createExecutor;
  const verifyBackupRestore = dependencies.verifyBackupRestore ?? verifyPostgresBackupRestore;
  const exists = dependencies.backupPathExists ?? backupPathExists;
  const removeFile = dependencies.removeFile ?? ((target) => rm(target, { force: true }));

  if (await exists(input.backupPath)) {
    throw new Error("restore drill backup path already exists");
  }

  const source = makeExecutor(input.sourceUrl);
  const fixture = fixtureIds();
  let seeded = false;
  try {
    await assertDisposableSource(source);
    await seedRepresentativeRun(source, fixture);
    seeded = true;

    const backup = await verifyBackupRestore({
      sourceUrl: input.sourceUrl,
      restoreUrl: input.restoreUrl,
      backupPath: input.backupPath,
      confirmation: BACKUP_RESTORE_CONFIRMATION,
    });

    const restored = makeExecutor(input.restoreUrl);
    try {
      const result = await restored.query(
        `select release_runs.status as run_status, release_run_attempts.status as attempt_status
           from release_runs
           join release_run_attempts on release_run_attempts.run_id = release_runs.id
          where release_runs.id = $1 and release_run_attempts.id = $2`,
        [fixture.runId, fixture.attemptId],
      );
      const row = result.rows[0];
      const restoredRunStateVerified = row?.run_status === "queued" && row?.attempt_status === "queued";
      return summarizePostgresRestoreDrill({ backup, restoredRunStateVerified });
    } finally {
      await restored.close();
    }
  } finally {
    if (seeded) {
      await source.query("delete from installations where id = $1", [fixture.installationId]).catch(() => undefined);
    }
    await source.close();
    await removeFile(input.backupPath).catch(() => undefined);
  }
}

async function main() {
  const result = await runPostgresRestoreDrill({
    sourceUrl: process.env.BOARDREADYOPS_RESTORE_DRILL_SOURCE_DATABASE_URL ?? "",
    restoreUrl: process.env.BOARDREADYOPS_RESTORE_DRILL_TARGET_DATABASE_URL ?? "",
    backupPath: process.env.BOARDREADYOPS_RESTORE_DRILL_BACKUP_PATH ?? "",
    confirmation: process.env.BOARDREADYOPS_RESTORE_DRILL_CONFIRMATION ?? "",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "control-plane restore drill failed"}\n`);
    process.exitCode = 1;
  }
}
