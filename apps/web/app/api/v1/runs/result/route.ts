import { releaseRunResultSchema } from "@boardreadyops/contracts";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createGitHubAppCheckRunClient } from "../../../../../lib/github-app-check-run-client.js";

export const runtime = "nodejs";

type QueryRow = Record<string, unknown>;
type CheckConclusion = "failure" | "neutral" | "success" | "timed_out";

const resultKeyEnvName = "BOARDREADYOPS" + "_RUNNER_RESULT_KEY";
const resultKeyHeaderName = "x-boardreadyops-runner-key";

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }

  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function stringCell(row: QueryRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function numberLikeCell(row: QueryRow, key: string): number | string | undefined {
  const value = row[key];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
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

function terminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "timed_out";
}

function checkConclusion(status: string, decision: string | null): CheckConclusion {
  if (status === "timed_out") {
    return "timed_out";
  }

  if (status === "completed" && decision === "pass") {
    return "success";
  }

  if (status === "failed" || decision === "fail" || decision === "error") {
    return "failure";
  }

  return "neutral";
}

function checkSummary(input: { status: string; decision: string | null; findings: readonly unknown[] }): string {
  const plural = input.findings.length === 1 ? "finding" : "findings";
  return `Runner reported status=${input.status}, decision=${input.decision ?? "none"}, ${input.findings.length} ${plural}.`;
}

export async function POST(request: Request): Promise<Response> {
  const configuredKey = process.env[resultKeyEnvName];
  const suppliedKey = request.headers.get(resultKeyHeaderName);

  if (!configuredKey) {
    return Response.json({ ok: false, error: "runner result key is not configured" }, { status: 503 });
  }

  if (!suppliedKey || suppliedKey !== configuredKey) {
    return Response.json({ ok: false, error: "invalid runner result key" }, { status: 401 });
  }

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
    `with updated as (
       update release_runs
       set status = $2,
           decision = $3,
           completed_at = case when $2 in ('completed', 'failed', 'timed_out') then coalesce(completed_at, $4::timestamptz) else completed_at end,
           duration_ms = case when $2 in ('completed', 'failed', 'timed_out') then greatest(0, floor(extract(epoch from ($4::timestamptz - started_at)) * 1000))::integer else duration_ms end
       where id = $1
       returning id, github_check_run_id, repository_id
     )
     select updated.id,
            updated.github_check_run_id,
            repositories.owner,
            repositories.name,
            installations.github_installation_id
     from updated
     join repositories on repositories.id = updated.repository_id
     join installations on installations.id = repositories.installation_id`,
    [runId, parsed.data.status, parsed.data.decision, completedAt],
  );
  const row = rows(updateResult)[0];

  if (!row) {
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

  const githubCheckRunId = numberLikeCell(row, "github_check_run_id");
  let checkRunUpdated = false;

  if (githubCheckRunId && terminalStatus(parsed.data.status)) {
    const checkRunClient = createGitHubAppCheckRunClient();
    const installationId = numberLikeCell(row, "github_installation_id");
    const repositoryOwner = stringCell(row, "owner");
    const repositoryName = stringCell(row, "name");

    if (!checkRunClient?.completeCheckRun || !installationId || !repositoryOwner || !repositoryName) {
      return Response.json({ ok: false, error: "GitHub check-run completion is not configured" }, { status: 503 });
    }

    await checkRunClient.completeCheckRun({
      installationId,
      repositoryOwner,
      repositoryName,
      checkRunId: githubCheckRunId,
      runId,
      conclusion: checkConclusion(parsed.data.status, parsed.data.decision),
      title: "BoardReadyOps release readiness",
      summary: checkSummary(parsed.data),
      completedAt: new Date().toISOString(),
    });
    checkRunUpdated = true;
  }

  return Response.json({ ok: true, status: "accepted", runId, checkRunUpdated, result: parsed.data }, { status: 202 });
}
