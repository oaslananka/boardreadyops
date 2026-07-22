import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { verifyControlPlaneWorkerBoundary } from "./verify-control-plane-worker-boundary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, "apps/web/.next");
await mkdir(outputDirectory, { recursive: true });

const nodeBundleOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
};

const workerBuild = await build({
  ...nodeBundleOptions,
  entryPoints: [join(root, "apps/web/worker.ts")],
  outfile: join(outputDirectory, "worker.mjs"),
  metafile: true,
});
const workerMetadataPath = join(outputDirectory, "worker-meta.json");
await writeFile(workerMetadataPath, `${JSON.stringify(workerBuild.metafile, null, 2)}\n`, "utf8");
verifyControlPlaneWorkerBoundary(workerBuild.metafile);

const migrationsDirectory = join(root, "packages/db/migrations");
const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort();
const migrations = await Promise.all(
  migrationFiles.map(async (file) => ({
    version: file.replace(/\.sql$/u, ""),
    sql: await readFile(join(migrationsDirectory, file), "utf8"),
  })),
);

const migrationEntry = String.raw`
import pg from "pg";
const { Pool } = pg;
const migrations = ${JSON.stringify(migrations)};

async function applyMigrations() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required to apply BoardReadyOps Cloud migrations");
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "create table if not exists cloud_schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const appliedResult = await client.query("select version from cloud_schema_migrations order by version asc");
    const applied = new Set(appliedResult.rows.map((row) => String(row.version)));
    const pending = migrations.filter((migration) => !applied.has(migration.version));
    for (const migration of pending) {
      process.stdout.write(JSON.stringify({ event: "migration.applying", version: migration.version }) + "\n");
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into cloud_schema_migrations (version) values ($1) on conflict (version) do nothing",
          [migration.version],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    process.stdout.write(JSON.stringify({ event: "migration.completed", applied: pending.map((migration) => migration.version) }) + "\n");
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigrations().catch((error) => {
  process.stderr.write(JSON.stringify({
    event: "migration.failed",
    errorClass: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message.slice(0, 500) : "Migration failed.",
  }) + "\n");
  process.exitCode = 1;
});
`;

await build({
  ...nodeBundleOptions,
  stdin: {
    contents: migrationEntry,
    resolveDir: join(root, "packages/db"),
    sourcefile: "control-plane-migrate.mjs",
    loader: "js",
  },
  outfile: join(outputDirectory, "migrate.mjs"),
});
