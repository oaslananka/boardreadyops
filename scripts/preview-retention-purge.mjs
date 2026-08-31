#!/usr/bin/env node

/**
 * Operator CLI script to preview expired artifact retention candidates.
 *
 * This script runs a strictly read-only dry-run preview of artifacts that have
 * reached their retention deadline (based on persisted deadlines, plan tier
 * defaults, custom retention policies, and legal hold exclusions).
 *
 * It does NOT modify or delete any database rows or blob storage objects.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";

const { Pool } = pg;

const { values } = parseArgs({
  options: {
    "database-url": { type: "string" },
    "database-url-file": { type: "string" },
    limit: { type: "string", default: "1000" },
    format: { type: "string", default: "text" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
  allowPositionals: false,
});

function writeLine(message) {
  process.stdout.write(`${message}\n`);
}

if (values.help) {
  writeLine(`
Usage: node scripts/preview-retention-purge.mjs [options]

Options:
  --database-url <url>        PostgreSQL connection string
  --database-url-file <path>  File containing PostgreSQL connection string
  --limit <number>            Maximum candidates to preview (default: 1000)
  --format <text|json>        Output format (default: text)
  -h, --help                  Show help
`);
  process.exit(0);
}

async function resolveDatabaseUrl() {
  if (values["database-url"]) return values["database-url"];
  if (values["database-url-file"]) {
    return (await readFile(values["database-url-file"], "utf8")).trim();
  }
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return null;
}

const dbUrl = await resolveDatabaseUrl();
if (!dbUrl) {
  if (values.format === "json") {
    writeLine(JSON.stringify({ status: "skipped", reason: "DATABASE_URL not configured" }, null, 2));
  } else {
    writeLine("Retention Purge Preview: SKIPPED (No DATABASE_URL or --database-url-file provided)");
  }
  process.exit(0);
}

const limit = Math.max(1, Number.parseInt(values.limit ?? "1000", 10) || 1000);
const pool = new Pool({ connectionString: dbUrl, max: 1 });

try {
  const at = new Date().toISOString();
  const result = await pool.query(
    `with candidates as (
       select artifacts.id
       from artifacts
       join release_runs on release_runs.id = artifacts.run_id
       join repositories on repositories.id = release_runs.repository_id
       join installations on installations.id = repositories.installation_id
       left join retention_policies on retention_policies.tenant_id = installations.account_login
       where (
         artifacts.retention_until <= $1::timestamptz
         or (
           artifacts.retention_until is null
           and case
               when retention_policies.retention_days is not null then retention_policies.retention_days
               when installations.plan_tier = 'free' then 30
               when installations.plan_tier = 'team' then 365
               else null
             end is not null
           and artifacts.uploaded_at <= $1::timestamptz - make_interval(
             days => case
               when retention_policies.retention_days is not null then retention_policies.retention_days
               when installations.plan_tier = 'free' then 30
               when installations.plan_tier = 'team' then 365
               else null
             end
           )
         )
       )
         and not exists (
           select 1
           from legal_holds
           where legal_holds.tenant_id = installations.account_login
             and legal_holds.active = true
         )
       limit $2::integer
     )
     select count(*)::int as affected from candidates`,
    [at, limit],
  );

  const candidateCount = Number(result.rows?.[0]?.affected ?? 0);

  if (values.format === "json") {
    writeLine(
      JSON.stringify(
        {
          mode: "dry-run",
          previewOnly: true,
          deleted: 0,
          expiredArtifactCandidates: candidateCount,
          limit,
          timestamp: at,
        },
        null,
        2,
      ),
    );
  } else {
    writeLine("=== BoardReadyOps Retention Purge Preview (Dry Run) ===");
    writeLine(`Timestamp:                  ${at}`);
    writeLine(`Limit:                      ${limit}`);
    writeLine(`Expired Candidates Found:   ${candidateCount}`);
    writeLine("Objects Deleted:            0 (Dry-run mode, no data changed)");
    writeLine("======================================================");
  }
} finally {
  await pool.end();
}
