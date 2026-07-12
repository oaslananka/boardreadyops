import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  artifactDownloadExpiry,
  artifactDownloadUrl,
  configuredArtifactDownloadSigningKey,
} from "./artifact-downloads.js";

type RunDetail = {
  id: string;
  status: string;
  decision: string | undefined;
  commitSha: string;
  ref: string;
  pullRequestNumber: number | undefined;
  triggerKind: string;
  startedAt: string;
  completedAt: string | undefined;
  durationMs: number | undefined;
  boardReadyOpsVersion: string | undefined;
  kicadVersion: string | undefined;
  githubCheckRunId: string | undefined;
  readinessScore: number | undefined;
  resultContractVersion: number | undefined;
  conclusion: string | undefined;
  metrics: Readonly<Record<string, number>>;
  reportLinks: ReportLinkDetail[];
  lastPublicationAttemptAt: string | undefined;
  githubCheckPublishedAt: string | undefined;
  githubCommentPublishedAt: string | undefined;
  lastPublicationError: string | undefined;
  repository: string;
  findings: FindingDetail[];
  artifacts: ArtifactDetail[];
  attempts: AttemptDetail[];
};

type ReportLinkDetail = {
  label: string;
  url: string;
};

type FindingDetail = {
  ruleId: string;
  severity: string;
  message: string;
  path: string | undefined;
  kind: string | undefined;
  waivedAt: string | undefined;
};

type ArtifactDetail = {
  id: string;
  kind: string;
  name: string;
  sha256: string;
  bytes: number;
  role: string;
  uploadedAt: string;
  downloadUrl: string | undefined;
};

type AttemptDetail = {
  id: string;
  attemptNumber: number;
  status: string;
  createdAt: string;
  dispatchRequestedAt: string | undefined;
  dispatchedAt: string | undefined;
  startedAt: string | undefined;
  heartbeatAt: string | undefined;
  completedAt: string | undefined;
  retryAfterAt: string | undefined;
  workflowDispatchId: string | undefined;
  failureClass: string | undefined;
  failureMessage: string | undefined;
  resultDigest: string | undefined;
};

export type RunLookupResult = { state: "not-configured" } | { state: "not-found" } | { state: "found"; run: RunDetail };

export type RunDashboardQueryExecutor = {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
};

type QueryResult = {
  rows?: readonly Record<string, unknown>[];
};

type RunDashboardEnvironment = Readonly<Record<string, string | undefined>>;

type RunDashboardOptions = {
  artifactDownloadUrl?: (input: { runId: string; artifactId: string }) => string | undefined;
};

const severityRank: Readonly<Record<string, number>> = {
  critical: 0,
  error: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }

  const value = (result as QueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metricsValue(row: Record<string, unknown>, key: string): Readonly<Record<string, number>> {
  const value = row[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function reportLinksValue(row: Record<string, unknown>, key: string): ReportLinkDetail[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const label = (entry as Record<string, unknown>).label;
    const url = (entry as Record<string, unknown>).url;
    return typeof label === "string" && typeof url === "string" ? [{ label, url }] : [];
  });
}

function requiredString(row: Record<string, unknown>, key: string): string {
  return stringValue(row, key) ?? "";
}

function bySeverityThenRule(a: FindingDetail, b: FindingDetail): number {
  const rank = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
  return rank === 0 ? a.ruleId.localeCompare(b.ruleId) : rank;
}

export function formatRunDate(input: string | undefined): string {
  if (!input) {
    return "—";
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? input : date.toISOString();
}

export function formatRunDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function formatArtifactBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function lookupRunDashboard(
  runId: string,
  executor: RunDashboardQueryExecutor,
  options: RunDashboardOptions = {},
): Promise<RunLookupResult> {
  const runResult = await executor.query(
    `select
       release_runs.id,
       release_runs.status,
       release_runs.decision,
       release_runs.commit_sha,
       release_runs.ref,
       release_runs.pull_request_number,
       release_runs.trigger_kind,
       release_runs.started_at,
       release_runs.completed_at,
       release_runs.duration_ms,
       release_runs.board_ready_ops_version,
       release_runs.kicad_version,
       release_runs.github_check_run_id,
       release_runs.readiness_score,
       release_run_results.contract_version,
       release_run_results.conclusion,
       release_run_results.metrics,
       release_run_results.report_links,
       release_run_results.last_publication_attempt_at,
       release_run_results.github_check_published_at,
       release_run_results.github_comment_published_at,
       release_run_results.last_publication_error,
       repositories.owner,
       repositories.name
     from release_runs
     join repositories on repositories.id = release_runs.repository_id
     left join release_run_results on release_run_results.run_id = release_runs.id
     where release_runs.id = $1`,
    [runId],
  );
  const runRow = rows(runResult)[0];

  if (!runRow) {
    return { state: "not-found" };
  }

  const [findingsResult, artifactsResult, attemptsResult] = await Promise.all([
    executor.query(
      `select rule_id, severity, message, path, kind, waived_at
       from findings
       where run_id = $1`,
      [runId],
    ),
    executor.query(
      `select id, kind, name, sha256, bytes, role, uploaded_at
       from artifacts
       where run_id = $1
       order by uploaded_at desc`,
      [runId],
    ),
    executor.query(
      `select id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at,
              started_at, heartbeat_at, completed_at, retry_after_at,
              github_workflow_dispatch_id, failure_class, failure_message, result_digest
       from release_run_attempts
       where run_id = $1
       order by attempt_number desc`,
      [runId],
    ),
  ]);

  const findings = rows(findingsResult)
    .map(
      (row): FindingDetail => ({
        ruleId: requiredString(row, "rule_id"),
        severity: requiredString(row, "severity"),
        message: requiredString(row, "message"),
        path: stringValue(row, "path"),
        kind: stringValue(row, "kind"),
        waivedAt: stringValue(row, "waived_at"),
      }),
    )
    .sort(bySeverityThenRule);

  const artifacts = rows(artifactsResult).map((row): ArtifactDetail => {
    const artifactId = requiredString(row, "id");
    return {
      id: artifactId,
      kind: requiredString(row, "kind"),
      name: requiredString(row, "name"),
      sha256: requiredString(row, "sha256"),
      bytes: numberValue(row, "bytes") ?? 0,
      role: requiredString(row, "role"),
      uploadedAt: requiredString(row, "uploaded_at"),
      downloadUrl: options.artifactDownloadUrl?.({ runId, artifactId }),
    };
  });

  const attempts = rows(attemptsResult).map(
    (row): AttemptDetail => ({
      id: requiredString(row, "id"),
      attemptNumber: numberValue(row, "attempt_number") ?? 0,
      status: requiredString(row, "status"),
      createdAt: requiredString(row, "created_at"),
      dispatchRequestedAt: stringValue(row, "dispatch_requested_at"),
      dispatchedAt: stringValue(row, "dispatched_at"),
      startedAt: stringValue(row, "started_at"),
      heartbeatAt: stringValue(row, "heartbeat_at"),
      completedAt: stringValue(row, "completed_at"),
      retryAfterAt: stringValue(row, "retry_after_at"),
      workflowDispatchId: stringValue(row, "github_workflow_dispatch_id"),
      failureClass: stringValue(row, "failure_class"),
      failureMessage: stringValue(row, "failure_message"),
      resultDigest: stringValue(row, "result_digest"),
    }),
  );

  return {
    state: "found",
    run: {
      id: requiredString(runRow, "id"),
      status: requiredString(runRow, "status"),
      decision: stringValue(runRow, "decision"),
      commitSha: requiredString(runRow, "commit_sha"),
      ref: requiredString(runRow, "ref"),
      pullRequestNumber: numberValue(runRow, "pull_request_number"),
      triggerKind: requiredString(runRow, "trigger_kind"),
      startedAt: requiredString(runRow, "started_at"),
      completedAt: stringValue(runRow, "completed_at"),
      durationMs: numberValue(runRow, "duration_ms"),
      boardReadyOpsVersion: stringValue(runRow, "board_ready_ops_version"),
      kicadVersion: stringValue(runRow, "kicad_version"),
      githubCheckRunId: stringValue(runRow, "github_check_run_id"),
      readinessScore: numberValue(runRow, "readiness_score"),
      resultContractVersion: numberValue(runRow, "contract_version"),
      conclusion: stringValue(runRow, "conclusion"),
      metrics: metricsValue(runRow, "metrics"),
      reportLinks: reportLinksValue(runRow, "report_links"),
      lastPublicationAttemptAt: stringValue(runRow, "last_publication_attempt_at"),
      githubCheckPublishedAt: stringValue(runRow, "github_check_published_at"),
      githubCommentPublishedAt: stringValue(runRow, "github_comment_published_at"),
      lastPublicationError: stringValue(runRow, "last_publication_error"),
      repository: `${requiredString(runRow, "owner")}/${requiredString(runRow, "name")}`,
      findings,
      artifacts,
      attempts,
    },
  };
}

export async function loadRunDashboard(
  runId: string,
  environment: RunDashboardEnvironment = process.env,
): Promise<RunLookupResult> {
  const connectionString = environment.DATABASE_URL;

  if (!connectionString) {
    return { state: "not-configured" };
  }

  const baseUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  const key = configuredArtifactDownloadSigningKey(environment);
  const expiresAt = baseUrl && key ? artifactDownloadExpiry() : undefined;

  return await lookupRunDashboard(
    runId,
    createPgQueryExecutor({
      connectionString,
      max: Number(environment.DATABASE_POOL_MAX ?? 5),
    }),
    baseUrl && key && expiresAt
      ? {
          artifactDownloadUrl: ({ runId: resultRunId, artifactId }) =>
            artifactDownloadUrl({
              runId: resultRunId,
              artifactId,
              expiresAt,
              baseUrl,
              key,
            }),
        }
      : {},
  );
}
