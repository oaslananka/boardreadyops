import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(packageRoot, "migrations");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function envFlag(name) {
  return ["1", "true", "yes"].includes(String(process.env[name] ?? "").toLowerCase());
}

export async function listMigrationFiles(directory = migrationsDir) {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function appliedVersions(client) {
  await client.query(
    `create table if not exists cloud_schema_migrations (version text primary key, applied_at timestamptz not null default now())`,
  );
  const result = await client.query("select version from cloud_schema_migrations order by version asc");

  return new Set(result.rows.map((row) => String(row.version)));
}

export async function applyCloudMigrations({ connectionString, dryRun = false } = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to apply BoardReadyOps Cloud migrations");
  }

  const files = await listMigrationFiles();
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    const applied = dryRun ? new Set() : await appliedVersions(client);
    const pending = files.filter((file) => !applied.has(basename(file, ".sql")));

    if (pending.length === 0) {
      log("No pending BoardReadyOps Cloud migrations.");
      return { applied: [], pending: [] };
    }

    if (dryRun) {
      for (const file of pending) {
        log(`pending ${basename(file, ".sql")}`);
      }

      return { applied: [], pending: pending.map((file) => basename(file, ".sql")) };
    }

    const appliedNow = [];

    for (const file of pending) {
      const version = basename(file, ".sql");
      const sql = await readFile(join(migrationsDir, file), "utf8");

      log(`applying ${version}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into cloud_schema_migrations (version) values ($1) on conflict (version) do nothing",
          [version],
        );
        await client.query("commit");
        appliedNow.push(version);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    return { applied: appliedNow, pending: [] };
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyCloudMigrations({
    connectionString: process.env.DATABASE_URL,
    dryRun: envFlag("BOARDREADYOPS_DB_MIGRATE_DRY_RUN"),
  })
    .then((result) => {
      log(JSON.stringify(result));
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
