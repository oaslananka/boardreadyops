import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { artifactDownloadExpiry, artifactDownloadUrl } from "./artifact-downloads.js";

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
  repository: string;
  findings: FindingDetail[];
  artifacts: ArtifactDetail[];
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
       repositories.owner,
       repositories.name
     from release_runs
     join repositories on repositories.id = release_runs.repository_id
     where release_runs.id = $1`,
    [runId],
  );
  const runRow = rows(runResult)[0];

  if (!runRow) {
    return { state: "not-found" };
  }

  const [findingsResult, artifactsResult] = await Promise.all([
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
      repository: `${requiredString(runRow, "owner")}/${requiredString(runRow, "name")}`,
      findings,
      artifacts,
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
  const key = environment.ARTIFACT_DOWNLOAD_SIGNING_KEY;
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
