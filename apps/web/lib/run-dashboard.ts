import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  artifactDownloadExpiry,
  artifactDownloadUrl,
  configuredArtifactDownloadSigningKey,
} from "./artifact-downloads.js";

type RunInvestigationState =
  | "completed"
  | "current"
  | "dead_letter"
  | "failed"
  | "partial_data"
  | "reconciliation"
  | "stale"
  | "superseded"
  | "timed_out";

type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ReportLinkDetail = {
  label: string;
  url: string;
};

type FindingDetail = {
  id: string;
  ruleId: string;
  severity: string;
  message: string;
  path: string | undefined;
  kind: string | undefined;
  waivedAt: string | undefined;
};

type ArtifactAvailability = "available" | "metadata-only";

type ArtifactDetail = {
  id: string;
  kind: string;
  name: string;
  sha256: string;
  bytes: number;
  role: string;
  uploadedAt: string;
  downloadUrl: string | undefined;
  availability: ArtifactAvailability;
  retention: "no-automatic-expiry";
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

type TransitionDetail = {
  entityType: string;
  executionAttemptId: string | undefined;
  fromStatus: string;
  toStatus: string;
  fromVersion: number;
  toVersion: number;
  reasonCode: string;
  occurredAt: string;
};

export type RunDetail = {
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
  repositoryPrivate: boolean;
  investigationState: RunInvestigationState;
  reconciliationCount: number;
  deadLetterCount: number;
  lastActivityAt: string | undefined;
  findings: FindingDetail[];
  findingsPage: PageInfo;
  artifacts: ArtifactDetail[];
  artifactsPage: PageInfo;
  attempts: AttemptDetail[];
  transitions: TransitionDetail[];
};

export type RunDashboardFilters = {
  findingSearch?: string;
  findingSeverity?: string;
  findingState?: "active" | "all" | "waived";
  findingSort?: "path" | "rule" | "severity";
  findingGroup?: "kind" | "none" | "path" | "rule" | "severity";
  findingsPage?: number;
  artifactSearch?: string;
  artifactRole?: string;
  artifactKind?: string;
  artifactSort?: "name" | "newest" | "size";
  artifactsPage?: number;
  pageSize?: number;
};

export type RunLookupResult = { state: "not-configured" } | { state: "not-found" } | { state: "found"; run: RunDetail };

export type RunDashboardQueryExecutor = {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
};

type QueryResult = {
  rows?: readonly Record<string, unknown>[];
};

type RunDashboardEnvironment = Readonly<Record<string, string | undefined>>;

type RunDashboardLoaderDependencies = Readonly<{
  artifactDownloadExpiry: typeof artifactDownloadExpiry;
  artifactDownloadUrl: typeof artifactDownloadUrl;
  configuredArtifactDownloadSigningKey: typeof configuredArtifactDownloadSigningKey;
  createQueryExecutor: typeof createPgQueryExecutor;
}>;

const defaultRunDashboardLoaderDependencies: RunDashboardLoaderDependencies = {
  artifactDownloadExpiry,
  artifactDownloadUrl,
  configuredArtifactDownloadSigningKey,
  createQueryExecutor: createPgQueryExecutor,
};

type RunDashboardOptions = {
  artifactDownloadUrl?: (input: { runId: string; artifactId: string }) => string | undefined;
  filters?: RunDashboardFilters;
  now?: () => Date;
};

type NormalizedFilters = Required<
  Pick<RunDashboardFilters, "artifactSearch" | "artifactsPage" | "findingSearch" | "findingsPage" | "pageSize">
> & {
  artifactRole?: string;
  artifactKind?: string;
  artifactSort: "name" | "newest" | "size";
  findingSeverity?: string;
  findingSort: "path" | "rule" | "severity";
  findingState: "active" | "all" | "waived";
};

const activeRunStatuses = new Set(["queued", "dispatching", "dispatched", "running", "reporting"]);
const supportedFindingSeverities = new Set(["critical", "error", "high", "medium", "low", "info", "warning"]);
const maximumSearchLength = 128;
const facetPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const defaultPageSize = 25;
const maximumPageSize = 100;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as QueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanValue(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  return value === true || value === "true" || value === "t";
}

function metricsValue(row: Record<string, unknown>, key: string): Readonly<Record<string, number>> {
  const value = row[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function reportLinksValue(row: Record<string, unknown>, key: string): ReportLinkDetail[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const label = (entry as Record<string, unknown>).label;
    const url = (entry as Record<string, unknown>).url;
    if (typeof label !== "string" || typeof url !== "string") return [];
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? [{ label, url }] : [];
    } catch {
      return [];
    }
  });
}

function requiredString(row: Record<string, unknown>, key: string): string {
  return stringValue(row, key) ?? "";
}

function normalizedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 1) return fallback;
  return Math.min(value, maximum);
}

function normalizedSearch(value: string | undefined): string {
  return value?.trim().slice(0, maximumSearchLength) ?? "";
}

function normalizeFilters(filters: RunDashboardFilters | undefined): NormalizedFilters {
  const findingState = filters?.findingState;
  const findingSort = filters?.findingSort;
  const findingSeverity = filters?.findingSeverity?.trim().toLowerCase();
  const artifactRole = filters?.artifactRole?.trim().toLowerCase();
  const artifactKind = filters?.artifactKind?.trim().toLowerCase();
  const artifactSort = filters?.artifactSort;
  return {
    findingSearch: normalizedSearch(filters?.findingSearch),
    ...(findingSeverity && supportedFindingSeverities.has(findingSeverity) ? { findingSeverity } : {}),
    findingState: findingState === "active" || findingState === "waived" ? findingState : "all",
    findingSort: findingSort === "path" || findingSort === "rule" ? findingSort : "severity",
    findingsPage: normalizedPositiveInteger(filters?.findingsPage, 1, 100_000),
    artifactSearch: normalizedSearch(filters?.artifactSearch),
    ...(artifactRole && facetPattern.test(artifactRole) ? { artifactRole } : {}),
    ...(artifactKind && facetPattern.test(artifactKind) ? { artifactKind } : {}),
    artifactSort: artifactSort === "name" || artifactSort === "size" ? artifactSort : "newest",
    artifactsPage: normalizedPositiveInteger(filters?.artifactsPage, 1, 100_000),
    pageSize: normalizedPositiveInteger(filters?.pageSize, defaultPageSize, maximumPageSize),
  };
}

function escapedLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function pageInfo(page: number, pageSize: number, total: number): PageInfo {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(page, totalPages), pageSize, total, totalPages };
}

function findingPredicates(runId: string, filters: NormalizedFilters): { sql: string; parameters: unknown[] } {
  const predicates = ["findings.run_id = $1"];
  const parameters: unknown[] = [runId];
  if (filters.findingSearch) {
    parameters.push(`%${escapedLike(filters.findingSearch.toLowerCase())}%`);
    const placeholder = `$${parameters.length}`;
    predicates.push(
      String.raw`(lower(findings.rule_id) like ${placeholder} escape '\' or lower(findings.message) like ${placeholder} escape '\' or lower(coalesce(findings.path, '')) like ${placeholder} escape '\')`,
    );
  }
  if (filters.findingSeverity) {
    parameters.push(filters.findingSeverity);
    predicates.push(`lower(findings.severity) = $${parameters.length}`);
  }
  if (filters.findingState === "active") predicates.push("findings.waived_at is null");
  if (filters.findingState === "waived") predicates.push("findings.waived_at is not null");
  return { sql: predicates.join(" and "), parameters };
}

function findingOrder(sort: NormalizedFilters["findingSort"]): string {
  if (sort === "path") return "coalesce(findings.path, '') asc, findings.rule_id asc, findings.id asc";
  if (sort === "rule") return "findings.rule_id asc, findings.path asc nulls last, findings.id asc";
  return `case lower(findings.severity)
    when 'critical' then 0 when 'error' then 0 when 'high' then 1
    when 'medium' then 2 when 'warning' then 2 when 'low' then 3 when 'info' then 4 else 99 end,
    findings.rule_id asc, findings.id asc`;
}

function artifactPredicates(runId: string, filters: NormalizedFilters): { sql: string; parameters: unknown[] } {
  const predicates = ["artifacts.run_id = $1"];
  const parameters: unknown[] = [runId];
  if (filters.artifactSearch) {
    parameters.push(`%${escapedLike(filters.artifactSearch.toLowerCase())}%`);
    const placeholder = `$${parameters.length}`;
    predicates.push(
      String.raw`(lower(artifacts.name) like ${placeholder} escape '\' or lower(artifacts.kind) like ${placeholder} escape '\' or lower(artifacts.sha256) like ${placeholder} escape '\')`,
    );
  }
  if (filters.artifactRole) {
    parameters.push(filters.artifactRole);
    predicates.push(`lower(artifacts.role) = $${parameters.length}`);
  }
  if (filters.artifactKind) {
    parameters.push(filters.artifactKind);
    predicates.push(`lower(artifacts.kind) = $${parameters.length}`);
  }
  return { sql: predicates.join(" and "), parameters };
}

function artifactOrder(sort: NormalizedFilters["artifactSort"]): string {
  if (sort === "name") return "artifacts.name asc, artifacts.uploaded_at desc, artifacts.id desc";
  if (sort === "size") return "artifacts.bytes desc, artifacts.uploaded_at desc, artifacts.id desc";
  return "artifacts.uploaded_at desc, artifacts.id desc";
}

function investigationState(input: {
  status: string;
  reconciliationCount: number;
  deadLetterCount: number;
  resultContractVersion: number | undefined;
  lastActivityAt: string | undefined;
  now: Date;
}): RunInvestigationState {
  if (input.deadLetterCount > 0) return "dead_letter";
  if (input.reconciliationCount > 0) return "reconciliation";
  if (input.status === "failed") return "failed";
  if (input.status === "timed_out") return "timed_out";
  if (input.status === "superseded") return "superseded";
  if (input.status === "completed" && input.resultContractVersion === undefined) return "partial_data";
  if (input.status === "completed") return "completed";
  if (activeRunStatuses.has(input.status) && input.lastActivityAt) {
    const lastActivity = new Date(input.lastActivityAt);
    if (Number.isFinite(lastActivity.valueOf()) && input.now.valueOf() - lastActivity.valueOf() > 15 * 60_000) {
      return "stale";
    }
  }
  return "current";
}

export function formatRunDate(input: string | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? input : date.toISOString();
}

export function formatRunDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function formatArtifactBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function lookupRunDashboard(
  runId: string,
  executor: RunDashboardQueryExecutor,
  options: RunDashboardOptions = {},
): Promise<RunLookupResult> {
  const filters = normalizeFilters(options.filters);
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
       repositories.name,
       repositories.private,
       coalesce((
         select count(*)::int
         from control_plane_reconciliation_items
         where control_plane_reconciliation_items.release_run_id = release_runs.id
           and control_plane_reconciliation_items.status in ('available', 'leased')
       ), 0)::int as reconciliation_count,
       coalesce((
         select count(*)::int
         from control_plane_reconciliation_items
         where control_plane_reconciliation_items.release_run_id = release_runs.id
           and control_plane_reconciliation_items.status = 'dead_letter'
       ), 0)::int as dead_letter_count,
       coalesce((
         select max(coalesce(
           release_run_attempts.heartbeat_at,
           release_run_attempts.started_at,
           release_run_attempts.dispatched_at,
           release_run_attempts.dispatch_requested_at,
           release_run_attempts.created_at
         ))
         from release_run_attempts
         where release_run_attempts.run_id = release_runs.id
       ), release_runs.completed_at, release_runs.started_at) as last_activity_at
     from release_runs
     join repositories on repositories.id = release_runs.repository_id
     left join release_run_results on release_run_results.run_id = release_runs.id
     where release_runs.id = $1`,
    [runId],
  );
  const runRow = rows(runResult)[0];
  if (!runRow) return { state: "not-found" };

  const findingScope = findingPredicates(runId, filters);
  const artifactScope = artifactPredicates(runId, filters);

  const [findingCountResult, artifactCountResult, attemptsResult, transitionsResult] = await Promise.all([
    executor.query(`select count(*)::int as total from findings where ${findingScope.sql}`, findingScope.parameters),
    executor.query(`select count(*)::int as total from artifacts where ${artifactScope.sql}`, artifactScope.parameters),
    executor.query(
      `select id, attempt_number, status, created_at, dispatch_requested_at, dispatched_at,
              started_at, heartbeat_at, completed_at, retry_after_at,
              github_workflow_dispatch_id, failure_class, failure_message, result_digest
       from release_run_attempts
       where run_id = $1
       order by attempt_number desc
       limit 50`,
      [runId],
    ),
    executor.query(
      `select entity_type, execution_attempt_id, from_status, to_status,
              from_version::int as from_version, to_version::int as to_version,
              reason_code, occurred_at
       from release_run_transition_events
       where release_run_id = $1
       order by occurred_at desc, id desc
       limit 100`,
      [runId],
    ),
  ]);

  const findingTotal = numberValue(rows(findingCountResult)[0] ?? {}, "total") ?? 0;
  const artifactTotal = numberValue(rows(artifactCountResult)[0] ?? {}, "total") ?? 0;
  const findingsPage = pageInfo(filters.findingsPage, filters.pageSize, findingTotal);
  const artifactsPage = pageInfo(filters.artifactsPage, filters.pageSize, artifactTotal);
  const findingOffset = (findingsPage.page - 1) * filters.pageSize;
  const artifactOffset = (artifactsPage.page - 1) * filters.pageSize;

  const [findingsResult, artifactsResult] = await Promise.all([
    executor.query(
      `select findings.id, findings.rule_id, findings.severity, findings.message,
              findings.path, findings.kind, findings.waived_at
       from findings
       where ${findingScope.sql}
       order by ${findingOrder(filters.findingSort)}
       limit $${findingScope.parameters.length + 1}
       offset $${findingScope.parameters.length + 2}`,
      [...findingScope.parameters, filters.pageSize, findingOffset],
    ),
    executor.query(
      `select artifacts.id, artifacts.kind, artifacts.name, artifacts.sha256,
              artifacts.bytes, artifacts.role, artifacts.uploaded_at
       from artifacts
       where ${artifactScope.sql}
       order by ${artifactOrder(filters.artifactSort)}
       limit $${artifactScope.parameters.length + 1}
       offset $${artifactScope.parameters.length + 2}`,
      [...artifactScope.parameters, filters.pageSize, artifactOffset],
    ),
  ]);

  const findings = rows(findingsResult).map(
    (row): FindingDetail => ({
      id: requiredString(row, "id"),
      ruleId: requiredString(row, "rule_id"),
      severity: requiredString(row, "severity"),
      message: requiredString(row, "message"),
      path: stringValue(row, "path"),
      kind: stringValue(row, "kind"),
      waivedAt: stringValue(row, "waived_at"),
    }),
  );

  const artifacts = rows(artifactsResult).map((row): ArtifactDetail => {
    const artifactId = requiredString(row, "id");
    const downloadUrl = options.artifactDownloadUrl?.({ runId, artifactId });
    return {
      id: artifactId,
      kind: requiredString(row, "kind"),
      name: requiredString(row, "name"),
      sha256: requiredString(row, "sha256"),
      bytes: numberValue(row, "bytes") ?? 0,
      role: requiredString(row, "role"),
      uploadedAt: requiredString(row, "uploaded_at"),
      downloadUrl,
      availability: downloadUrl ? "available" : "metadata-only",
      retention: "no-automatic-expiry",
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

  const transitions = rows(transitionsResult).map(
    (row): TransitionDetail => ({
      entityType: requiredString(row, "entity_type"),
      executionAttemptId: stringValue(row, "execution_attempt_id"),
      fromStatus: requiredString(row, "from_status"),
      toStatus: requiredString(row, "to_status"),
      fromVersion: numberValue(row, "from_version") ?? 0,
      toVersion: numberValue(row, "to_version") ?? 0,
      reasonCode: requiredString(row, "reason_code"),
      occurredAt: requiredString(row, "occurred_at"),
    }),
  );

  const status = requiredString(runRow, "status");
  const reconciliationCount = numberValue(runRow, "reconciliation_count") ?? 0;
  const deadLetterCount = numberValue(runRow, "dead_letter_count") ?? 0;
  const resultContractVersion = numberValue(runRow, "contract_version");
  const lastActivityAt = stringValue(runRow, "last_activity_at");
  const now = options.now?.() ?? new Date();

  return {
    state: "found",
    run: {
      id: requiredString(runRow, "id"),
      status,
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
      resultContractVersion,
      conclusion: stringValue(runRow, "conclusion"),
      metrics: metricsValue(runRow, "metrics"),
      reportLinks: reportLinksValue(runRow, "report_links"),
      lastPublicationAttemptAt: stringValue(runRow, "last_publication_attempt_at"),
      githubCheckPublishedAt: stringValue(runRow, "github_check_published_at"),
      githubCommentPublishedAt: stringValue(runRow, "github_comment_published_at"),
      lastPublicationError: stringValue(runRow, "last_publication_error"),
      repository: `${requiredString(runRow, "owner")}/${requiredString(runRow, "name")}`,
      repositoryPrivate: booleanValue(runRow, "private"),
      investigationState: investigationState({
        status,
        reconciliationCount,
        deadLetterCount,
        resultContractVersion,
        lastActivityAt,
        now,
      }),
      reconciliationCount,
      deadLetterCount,
      lastActivityAt,
      findings,
      findingsPage,
      artifacts,
      artifactsPage,
      attempts,
      transitions,
    },
  };
}

export async function loadRunDashboard(
  runId: string,
  environment: RunDashboardEnvironment = process.env,
  filters: RunDashboardFilters = {},
  dependencies: RunDashboardLoaderDependencies = defaultRunDashboardLoaderDependencies,
): Promise<RunLookupResult> {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const baseUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  const key = dependencies.configuredArtifactDownloadSigningKey(environment);
  const expiresAt = baseUrl && key ? dependencies.artifactDownloadExpiry() : undefined;
  const executor = dependencies.createQueryExecutor({
    connectionString,
    max: Number(environment.DATABASE_POOL_MAX ?? 5),
  });

  try {
    return await lookupRunDashboard(runId, executor, {
      filters,
      ...(baseUrl && key && expiresAt
        ? {
            artifactDownloadUrl: ({ runId: resultRunId, artifactId }) =>
              dependencies.artifactDownloadUrl({
                runId: resultRunId,
                artifactId,
                expiresAt,
                baseUrl,
                key,
              }),
          }
        : {}),
    });
  } finally {
    await executor.close();
  }
}
