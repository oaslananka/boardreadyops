#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Operator-only, aggregate read-only observation. Never exposes a tenant, path,
 * deletion job, worker, token or a database/provider error.
 *
 * A missing grant, missing schema or RLS boundary MUST be reported as unknown,
 * never as a zero unresolved-fence count.
 */
export async function inspectArtifactUnlinkFences(client) {
  await client.query("BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '2s'");

    const table = await client.query(
      "SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = to_regclass('public.artifact_unlink_fences')",
    );
    if (table.rows.length !== 1) throw new Error("schema_unavailable");
    if (table.rows[0].relrowsecurity !== false) throw new Error("row_security_unverified");

    const result = await client.query(`
      SELECT count(*) AS unresolved_count, min(started_at) AS oldest_started_at
      FROM public.artifact_unlink_fences
      WHERE settled_at IS NULL
    `);
    const value = result.rows[0]?.unresolved_count;
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error("invalid_aggregate");
    }
    const unresolvedCount = Number(value);
    if (!Number.isSafeInteger(unresolvedCount)) throw new Error("invalid_aggregate");
    const oldest = result.rows[0]?.oldest_started_at;
    const oldestStartedAt = oldest instanceof Date ? oldest.toISOString() : oldest;
    if (unresolvedCount === 0 && oldestStartedAt != null) throw new Error("invalid_aggregate");
    if (
      unresolvedCount !== 0 &&
      (typeof oldestStartedAt !== "string" || !Number.isFinite(Date.parse(oldestStartedAt)))
    ) {
      throw new Error("invalid_aggregate");
    }

    await client.query("COMMIT");
    return { status: "observed", unresolvedCount, oldestStartedAt: oldestStartedAt ?? null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function classifyFenceInventoryFailure(error) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : "";
  if (code === "42501") return "permission_denied";
  if (code === "42P01" || message === "schema_unavailable") return "schema_unavailable";
  if (message === "row_security_unverified") return "row_security_unverified";
  return "observation_failed";
}

async function main() {
  // Never accept a credential as a CLI argument; command history and CI logs
  // can disclose it. Connection string stays in the authorized environment.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stdout.write(`${JSON.stringify({ status: "unknown", reason: "missing_connection" })}\n`);
    process.exitCode = 2;
    return;
  }
  let client;
  try {
    client = new pg.Client({
      connectionString,
      application_name: "boardreadyops-fence-inventory",
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    process.stdout.write(`${JSON.stringify(await inspectArtifactUnlinkFences(client))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "unknown", reason: classifyFenceInventoryFailure(error) })}\n`);
    process.exitCode = 2;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
