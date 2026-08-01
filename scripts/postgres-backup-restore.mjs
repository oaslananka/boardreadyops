import { spawnSync } from "node:child_process";
import { lstat, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMigrationFiles } from "../packages/db/scripts/apply-migrations.mjs";
import { createPgQueryExecutor } from "../packages/db/src/pg-executor.js";

export const BACKUP_RESTORE_CONFIRMATION = "isolated-empty-database";

const inheritedEnvironmentNames = Object.freeze(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]);

const representativeTables = Object.freeze([
  "installations",
  "repositories",
  "release_runs",
  "release_run_attempts",
  "webhook_inbox",
  "control_plane_jobs",
  "control_plane_outbox",
]);

function parsedDatabaseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("database URL must be a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("database URL must use postgresql:// or postgres://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!database || database.includes("/")) {
    throw new Error("database URL must include a database name");
  }
  const port = url.port || "5432";
  return {
    database,
    host: url.hostname,
    identity: `${url.hostname}:${port}/${database}`,
    password: decodeURIComponent(url.password),
    port,
    sslmode: url.searchParams.get("sslmode") ?? undefined,
    user: decodeURIComponent(url.username),
  };
}

export function databaseIdentity(connectionString) {
  return parsedDatabaseUrl(connectionString).identity;
}

function clientEnvironment(database) {
  return {
    PGHOST: database.host,
    PGPORT: database.port,
    ...(database.user ? { PGUSER: database.user } : {}),
    ...(database.password ? { PGPASSWORD: database.password } : {}),
    ...(database.sslmode ? { PGSSLMODE: database.sslmode } : {}),
  };
}

export function buildPostgresBackupRestorePlan({
  sourceUrl,
  restoreUrl,
  backupPath,
  confirmation,
  pgDumpCommand = "pg_dump",
  pgRestoreCommand = "pg_restore",
}) {
  if (confirmation !== BACKUP_RESTORE_CONFIRMATION) {
    throw new Error("isolated restore confirmation is required");
  }
  if (!path.isAbsolute(backupPath)) {
    throw new Error("backup path must be absolute");
  }
  const source = parsedDatabaseUrl(sourceUrl);
  const restore = parsedDatabaseUrl(restoreUrl);
  if (source.identity === restore.identity) {
    throw new Error("restore database must differ from the source database");
  }
  return {
    backupPath,
    source: { identity: source.identity, database: source.database },
    restore: { identity: restore.identity, database: restore.database },
    dump: {
      command: pgDumpCommand,
      args: ["--format=custom", "--no-owner", "--no-privileges", "--dbname", source.database],
      environment: clientEnvironment(source),
      outputPath: backupPath,
    },
    restoreCommand: {
      command: pgRestoreCommand,
      args: ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", restore.database, backupPath],
      environment: clientEnvironment(restore),
    },
  };
}

function createExecutor(connectionString) {
  return createPgQueryExecutor({ connectionString, max: 1 });
}

async function publicTables(executor) {
  const result = await executor.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name asc`,
  );
  return result.rows.map((row) => String(row.table_name));
}

async function migrationVersions(executor) {
  const result = await executor.query("select version from cloud_schema_migrations order by version asc");
  return result.rows.map((row) => String(row.version));
}

async function representativeRowCounts(executor, tables) {
  const available = new Set(tables);
  const counts = {};
  for (const table of representativeTables) {
    if (!available.has(table)) continue;
    const result = await executor.query(`select count(*)::text as count from "${table}"`);
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

async function databaseSnapshot(executor) {
  const tables = await publicTables(executor);
  return {
    tables,
    migrations: await migrationVersions(executor),
    representativeCounts: await representativeRowCounts(executor, tables),
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCounts(left, right) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => left[key] === right[key]);
}

export function buildPostgresCommandEnvironment(baseEnvironment, postgresEnvironment) {
  const environment = {};
  for (const name of inheritedEnvironmentNames) {
    const value = baseEnvironment[name];
    if (value) environment[name] = value;
  }
  return { ...environment, ...postgresEnvironment };
}

async function defaultRunCommand({ command, args, environment, outputPath }) {
  let output;
  let succeeded = false;
  try {
    if (outputPath) {
      try {
        output = await open(outputPath, "wx", 0o600);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          throw new Error("backup path already exists");
        }
        throw new Error("backup output path could not be created");
      }
    }
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env: buildPostgresCommandEnvironment(process.env, environment),
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", output?.fd ?? "pipe", "pipe"],
    });
    if (result.error) {
      throw new Error(`${command} could not be started (${result.error.name})`);
    }
    if (result.status !== 0) {
      throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
    }
    succeeded = true;
  } finally {
    await output?.close();
    if (!succeeded && outputPath) await rm(outputPath, { force: true });
  }
}

async function defaultBackupPathExists(backupPath) {
  try {
    await lstat(backupPath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw new Error("backup path could not be inspected");
  }
}

export async function verifyPostgresBackupRestore(input, dependencies = {}) {
  const plan = buildPostgresBackupRestorePlan(input);
  const makeExecutor = dependencies.createExecutor ?? createExecutor;
  const readMigrationFiles = dependencies.readMigrationFiles ?? listMigrationFiles;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const fileSize = dependencies.fileSize ?? (async (backupPath) => (await stat(backupPath)).size);
  const backupPathExists = dependencies.backupPathExists ?? defaultBackupPathExists;

  if (await backupPathExists(plan.backupPath)) {
    throw new Error("backup path already exists");
  }

  const preRestore = makeExecutor(input.restoreUrl);
  try {
    const targetTables = await publicTables(preRestore);
    if (targetTables.length > 0) {
      throw new Error("restore database must be empty");
    }
  } finally {
    await preRestore.close();
  }

  const source = makeExecutor(input.sourceUrl);
  let sourceSnapshot;
  try {
    sourceSnapshot = await databaseSnapshot(source);
  } finally {
    await source.close();
  }

  const expectedMigrations = (await readMigrationFiles()).map((file) => file.replace(/\.sql$/u, ""));
  if (!sameArray(sourceSnapshot.migrations, expectedMigrations)) {
    throw new Error("source database migrations do not match the repository migration set");
  }

  await runCommand(plan.dump);
  const backupBytes = await fileSize(plan.backupPath);
  if (!Number.isSafeInteger(backupBytes) || backupBytes <= 0) {
    throw new Error("backup file is empty or unreadable");
  }

  await runCommand(plan.restoreCommand);

  const restored = makeExecutor(input.restoreUrl);
  let restoredSnapshot;
  try {
    restoredSnapshot = await databaseSnapshot(restored);
  } finally {
    await restored.close();
  }

  if (!sameArray(restoredSnapshot.migrations, sourceSnapshot.migrations)) {
    throw new Error("restored migration versions do not match the source");
  }
  if (!sameArray(restoredSnapshot.tables, sourceSnapshot.tables)) {
    throw new Error("restored public tables do not match the source");
  }
  if (!sameCounts(restoredSnapshot.representativeCounts, sourceSnapshot.representativeCounts)) {
    throw new Error("restored representative row counts do not match the source");
  }

  return {
    event: "postgres_backup_restore_verified",
    backupBytes,
    migrationCount: restoredSnapshot.migrations.length,
    publicTableCount: restoredSnapshot.tables.length,
    representativeRows: Object.values(restoredSnapshot.representativeCounts).reduce((sum, count) => sum + count, 0),
  };
}

async function main() {
  const result = await verifyPostgresBackupRestore({
    sourceUrl: process.env.BOARDREADYOPS_BACKUP_SOURCE_DATABASE_URL ?? "",
    restoreUrl: process.env.BOARDREADYOPS_BACKUP_RESTORE_DATABASE_URL ?? "",
    backupPath: process.env.BOARDREADYOPS_BACKUP_PATH ?? "",
    confirmation: process.env.BOARDREADYOPS_BACKUP_RESTORE_CONFIRMATION ?? "",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "PostgreSQL backup restore verification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
