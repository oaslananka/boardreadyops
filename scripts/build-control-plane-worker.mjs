import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { verifyControlPlaneWorkerBoundary } from "./verify-control-plane-worker-boundary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, "apps/web/.next");
const cloudCoreRequire = createRequire(join(root, "packages/cloud-core/package.json"));
const yamlBrowserEntry = join(dirname(cloudCoreRequire.resolve("yaml/package.json")), "browser/index.js");
await mkdir(outputDirectory, { recursive: true });

const nodeBundleOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  external: ["pg"],
};

const workerBuild = await build({
  ...nodeBundleOptions,
  alias: { yaml: yamlBrowserEntry },
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
  migrationFiles.map(async (file) => {
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    const sha256 = createHash("sha256").update(sql, "utf8").digest("hex");
    return {
      version: file.replace(/\.sql$/u, ""),
      sql,
      sha256,
    };
  }),
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
      "create table if not exists cloud_schema_migrations (version text primary key, applied_at timestamptz not null default now(), checksum text)",
    );
    // Add checksum column if missing on older deployments
    await client.query("alter table cloud_schema_migrations add column if not exists checksum text");

    const appliedResult = await client.query("select version, checksum from cloud_schema_migrations order by version asc");
    const appliedMap = new Map(appliedResult.rows.map((row) => [String(row.version), row.checksum ? String(row.checksum) : null]));

    for (const migration of migrations) {
      if (appliedMap.has(migration.version)) {
        const storedChecksum = appliedMap.get(migration.version);
        if (storedChecksum && storedChecksum !== migration.sha256) {
          throw new Error(
            "Applied migration checksum mutation detected for " +
              migration.version +
              ": stored " +
              storedChecksum.slice(0, 12) +
              "..., current " +
              migration.sha256.slice(0, 12) +
              "..."
          );
        }
      }
    }

    const pending = migrations.filter((migration) => !appliedMap.has(migration.version));
    for (const migration of pending) {
      process.stdout.write(JSON.stringify({ event: "migration.applying", version: migration.version }) + "\n");
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into cloud_schema_migrations (version, checksum) values ($1, $2) on conflict (version) do update set checksum = excluded.checksum",
          [migration.version, migration.sha256],
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
