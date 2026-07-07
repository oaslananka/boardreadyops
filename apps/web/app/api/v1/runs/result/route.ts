import { releaseRunResultSchema } from "@boardreadyops/contracts";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";

export const runtime = "nodejs";

type QueryRow = Record<string, unknown>;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }

  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function queryExecutor() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return undefined;
  }

  return createPgQueryExecutor({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
}

export async function POST(request: Request): Promise<Response> {
  const runId = new URL(request.url).searchParams.get("run_id");

  if (!runId) {
    return Response.json({ ok: false, error: "run_id query parameter is required" }, { status: 400 });
  }

  const parsed = releaseRunResultSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid runner result" }, { status: 400 });
  }

  const executor = queryExecutor();

  if (!executor) {
    return Response.json({ ok: false, error: "database is not configured" }, { status: 503 });
  }

  const completedAt = new Date().toISOString();
  const updateResult = await executor.query(
    `update release_runs
     set status = $2,
         decision = $3,
         completed_at = case when $2 in ('completed', 'failed', 'timed_out') then coalesce(completed_at, $4::timestamptz) else completed_at end,
         duration_ms = case when $2 in ('completed', 'failed', 'timed_out') then greatest(0, floor(extract(epoch from ($4::timestamptz - started_at)) * 1000))::integer else duration_ms end
     where id = $1
     returning id`,
    [runId, parsed.data.status, parsed.data.decision, completedAt],
  );

  if (!rows(updateResult)[0]) {
    return Response.json({ ok: false, error: "release run not found" }, { status: 404 });
  }

  await executor.query("delete from findings where run_id = $1", [runId]);

  for (const finding of parsed.data.findings) {
    await executor.query(
      `insert into findings (run_id, rule_id, severity, message, path)
       values ($1, $2, $3, $4, $5)`,
      [runId, finding.ruleId, finding.severity, finding.message, finding.path ?? null],
    );
  }

  return Response.json({ ok: true, status: "accepted", runId, result: parsed.data }, { status: 202 });
}