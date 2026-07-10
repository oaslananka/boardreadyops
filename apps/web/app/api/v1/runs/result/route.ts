import { createHmac, timingSafeEqual } from "node:crypto";
import { releaseRunResultSchema } from "@boardreadyops/contracts";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  createGitHubAppCheckRunClient,
  detailsUrl as githubDetailsUrl,
} from "../../../../../lib/github-app-check-run-client.js";
import { buildReadinessCheckOutput, buildReadinessPrComment } from "../../../../../lib/readiness-result-format.js";

export const runtime = "nodejs";

type QueryRow = Record<string, unknown>;
type CheckConclusion = "failure" | "neutral" | "success" | "timed_out";
type ResultQueryExecutor = ReturnType<typeof createPgQueryExecutor>;
type GitHubAppCheckRunClient = NonNullable<ReturnType<typeof createGitHubAppCheckRunClient>>;

export type ResultRouteDependencies = {
  queryExecutor: () => ResultQueryExecutor | undefined;
  checkRunClient: () => GitHubAppCheckRunClient | undefined;
  detailsUrl: (runId: string) => string | undefined;
  now: () => Date;
};

const resultKeyEnvName = "BOARDREADYOPS" + "_RUNNER_RESULT_KEY";
const resultKeyHeaderName = "x-boardreadyops-runner-key";
const resultSignatureHeaderName = "x-boardreadyops-runner-signature";
const resultTimestampHeaderName = "x-boardreadyops-runner-timestamp";
const signatureToleranceSeconds = 10 * 60;

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

function numberCell(row: QueryRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function numberLikeCell(row: QueryRow, key: string): number | string | undefined {
  const value = row[key];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function createDefaultQueryExecutor() {
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

function expectedSignature(key: string, timestamp: string, runId: string, body: string): string {
  return `sha256=${createHmac("sha256", key).update(`${timestamp}.${runId}.${body}`).digest("hex")}`;
}

function signatureIsFresh(timestamp: string): boolean {
  const value = Number(timestamp);
  if (!Number.isInteger(value)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - value) <= signatureToleranceSeconds;
}

function secureCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyRunnerAuthentication(request: Request, input: { key: string; runId: string; body: string }): boolean {
  const suppliedSignature = request.headers.get(resultSignatureHeaderName);
  const suppliedTimestamp = request.headers.get(resultTimestampHeaderName);

  if (suppliedSignature && suppliedTimestamp) {
    if (!signatureIsFresh(suppliedTimestamp)) {
      return false;
    }

    return secureCompare(suppliedSignature, expectedSignature(input.key, suppliedTimestamp, input.runId, input.body));
  }

  if (process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE === "1") {
    return false;
  }

  return request.headers.get(resultKeyHeaderName) === input.key;
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

const defaultDependencies: ResultRouteDependencies = {
  queryExecutor: createDefaultQueryExecutor,
  checkRunClient: createGitHubAppCheckRunClient,
  detailsUrl: githubDetailsUrl,
  now: () => new Date(),
};

export async function handleResultRequest(
  request: Request,
  dependencies: ResultRouteDependencies = defaultDependencies,
): Promise<Response> {
  const configuredKey = process.env[resultKeyEnvName];

  if (!configuredKey) {
    return Response.json({ ok: false, error: "runner result key is not configured" }, { status: 503 });
  }

  const runId = new URL(request.url).searchParams.get("run_id");

  if (!runId) {
    return Response.json({ ok: false, error: "run_id query parameter is required" }, { status: 400 });
  }

  const bodyText = await request.text();

  if (!verifyRunnerAuthentication(request, { key: configuredKey, runId, body: bodyText })) {
    return Response.json({ ok: false, error: "invalid runner result signature" }, { status: 401 });
  }

  const body = parseJson(bodyText);

  if (body === undefined) {
    return Response.json({ ok: false, error: "invalid runner result JSON" }, { status: 400 });
  }

  const parsed = releaseRunResultSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid runner result" }, { status: 400 });
  }

  const executor = dependencies.queryExecutor();

  if (!executor) {
    return Response.json({ ok: false, error: "database is not configured" }, { status: 503 });
  }

  const completedAt = dependencies.now().toISOString();
  const updateResult = await executor.query(
    `with updated as (
       update release_runs
       set status = $2,
           decision = $3,
           completed_at = case when $2 in ('completed', 'failed', 'timed_out') then coalesce(completed_at, $4::timestamptz) else completed_at end,
           duration_ms = case when $2 in ('completed', 'failed', 'timed_out') then greatest(0, floor(extract(epoch from ($4::timestamptz - started_at)) * 1000))::integer else duration_ms end
       where id = $1
       returning id, github_check_run_id, repository_id, pull_request_number
     )
     select updated.id,
            updated.github_check_run_id,
            updated.pull_request_number,
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
  let pullRequestCommentCreated = false;

  if (terminalStatus(parsed.data.status)) {
    const checkRunClient = dependencies.checkRunClient();
    const installationId = numberLikeCell(row, "github_installation_id");
    const repositoryOwner = stringCell(row, "owner");
    const repositoryName = stringCell(row, "name");
    const runDetailsUrl = dependencies.detailsUrl(runId);
    const checkOutput = buildReadinessCheckOutput({ ...parsed.data, detailsUrl: runDetailsUrl });

    if (githubCheckRunId) {
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
        title: checkOutput.title,
        summary: checkOutput.summary,
        completedAt,
      });
      checkRunUpdated = true;
    }

    const pullRequestNumber = numberCell(row, "pull_request_number");
    if (
      pullRequestNumber &&
      checkRunClient?.createPullRequestComment &&
      installationId &&
      repositoryOwner &&
      repositoryName
    ) {
      await checkRunClient.createPullRequestComment({
        installationId,
        repositoryOwner,
        repositoryName,
        pullRequestNumber,
        body: buildReadinessPrComment({ ...parsed.data, detailsUrl: runDetailsUrl }),
      });
      pullRequestCommentCreated = true;
    }
  }

  return Response.json(
    { ok: true, status: "accepted", runId, checkRunUpdated, pullRequestCommentCreated, result: parsed.data },
    { status: 202 },
  );
}

export async function POST(request: Request): Promise<Response> {
  return await handleResultRequest(request);
}
