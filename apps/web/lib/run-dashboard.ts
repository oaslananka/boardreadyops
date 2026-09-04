import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  artifactDownloadExpiry,
  artifactDownloadUrl,
  configuredArtifactDownloadSigningKey,
} from "./artifact-downloads.js";

type RunTrustMode = "safe" | "standard";
type RunSafeModeReason = "draft-pull-request" | "fork-pull-request" | "private-repository";

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

/**
 * Per-domain finding rollup for the whole run (src/core/rule-registry.ts's RuleCategory on the
 * CLI side; persisted per finding in the findings.category column, migration 0062). Independent
 * of the findings table's own filter/pagination -- this describes the run as a whole.
 */
type CategoryBreakdownEntry = {
  category: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

type ArtifactAvailability = "available";

type ArtifactLifecycleSummary = {
  deleted: number;
  missing: number;
  pendingDeletion: number;
  failedDeletion: number;
};

type ArtifactDetail = {
  id: string;
  kind: string;
  name: string;
  sha256: string;
  bytes: number;
  role: string;
  contentType: string;
  executionAttemptId: string | undefined;
  uploadedAt: string;
  downloadUrl: string | undefined;
  availability: ArtifactAvailability;
  retention: "no-automatic-expiry" | "retained-until";
  retentionUntil: string | undefined;
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
  workflowRunUrl: string | undefined;
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

/**
 * One board's BOM as this run captured it.
 *
 * `unidentifiedComponentCount` is the count without a manufacturer part number. Those parts
 * cannot be matched against supplier data later, so the gap is reported rather than hidden.
 */
type RunBoardDetail = {
  boardId: string;
  project: string;
  displayName: string;
  capturedAt: string;
  componentCount: number;
  identifiedComponentCount: number;
  unidentifiedComponentCount: number;
  riskyLifecycleCount: number;
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
  repositoryId: string;
  repositoryPrivate: boolean;
  trustMode: RunTrustMode;
  safeModeReasons: RunSafeModeReason[];
  setupPreset?: string;
  setupPresetVersion?: number;
  setupRevision?: number;
  setupWorkflowContractVersion?: number;
  setupWorkflowStatus?: string;
  setupConfigStatus?: string;
  investigationState: RunInvestigationState;
  reconciliationCount: number;
  deadLetterCount: number;
  lastActivityAt: string | undefined;
  findings: FindingDetail[];
  findingsPage: PageInfo;
  categoryBreakdown: CategoryBreakdownEntry[];
  artifacts: ArtifactDetail[];
  artifactsPage: PageInfo;
  artifactLifecycle: ArtifactLifecycleSummary;
  attempts: AttemptDetail[];
  transitions: TransitionDetail[];
  boards: RunBoardDetail[];
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

export function formatRunPageTitle(run: RunDetail, section: string): string {
  const identity = run.pullRequestNumber !== undefined ? `PR #${run.pullRequestNumber}` : run.commitSha.slice(0, 7);
  return `${section} · ${run.repository} ${identity}`;
}

/**
 * Shared by every runs/[runId]/**\/page.tsx's generateMetadata(): each page needs the same
 * lookup-then-title-or-fallback logic, just with a different section label.
 */
export async function resolveRunPageTitle(
  runId: string,
  section: string,
  authorizeRepository: RunDashboardLoaderDependencies["authorizeRepository"],
): Promise<string> {
  const result = await loadRunDashboard(
    runId,
    process.env,
    {},
    {
      ...runDashboardLoaderDependencies,
      ...(authorizeRepository ? { authorizeRepository } : {}),
    },
  );
  return result.state === "found" ? formatRunPageTitle(result.run, section) : "Run";
}

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
  authorizeRepository?: (repository: RunDashboardRepository) => boolean | Promise<boolean>;
}>;

/**
 * Loader dependencies without a viewer.
 *
 * Exported so a page can spread these and add `authorizeRepository` for the signed-in viewer.
 * Without one, a private repository resolves to "not found" — the safe default, and the reason
 * `tests/unit/web/run-page-authorization.test.ts` asserts every run page supplies an authorizer
 * rather than relying on anyone remembering to.
 *
 * The viewer helper is not wired in here because it reads request-scoped cookies through
 * `next/headers`, which only the app's own compilation resolves.
 */
export const runDashboardLoaderDependencies: RunDashboardLoaderDependencies = {
  artifactDownloadExpiry,
  artifactDownloadUrl,
  configuredArtifactDownloadSigningKey,
  createQueryExecutor: createPgQueryExecutor,
};

const defaultRunDashboardLoaderDependencies = runDashboardLoaderDependencies;

type RunDashboardRepository = {
  id: string;
  installationId: string;
  owner: string;
  name: string;
  private: boolean;
};

type RunDashboardScope = {
  installationId: string;
  repositoryId: string;
};

type RunDashboardOptions = {
  artifactDownloadUrl?: (input: { runId: string; artifactId: string }) => string | undefined;
  authorizeRepository?: (repository: RunDashboardRepository) => boolean | Promise<boolean>;
  filters?: RunDashboardFilters;
  now?: () => Date;
  scope?: RunDashboardScope;
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
const supportedSafeModeReasons = [
  "draft-pull-request",
  "fork-pull-request",
  "private-repository",
] as const satisfies readonly RunSafeModeReason[];
const supportedFindingSeverities = new Set(["critical", "error", "high", "medium", "low", "info", "warning"]);
const maximumSearchLength = 128;
const facetPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

function repositoryPrivateValue(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (value === false || value === 0) return false;
  if (typeof value !== "string") return true;
  return !["false", "f", "0"].includes(value.trim().toLowerCase());
}

function uuidValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = stringValue(row, key);
  return value && uuidPattern.test(value) ? value : undefined;
}

function validScope(scope: RunDashboardScope | undefined): boolean {
  return scope === undefined || (uuidPattern.test(scope.installationId) && uuidPattern.test(scope.repositoryId));
}

function safeModeReasonsValue(row: Record<string, unknown>, key: string): RunSafeModeReason[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  const observed = new Set(value.filter((entry): entry is string => typeof entry === "string"));
  return supportedSafeModeReasons.filter((reason) => observed.has(reason));
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

export function githubActionsRunUrl(repository: string, workflowRunId: string | undefined): string | undefined {
  if (!workflowRunId || !/^[1-9]\d{0,19}$/u.test(workflowRunId)) return undefined;
  const [owner, name, ...rest] = repository.split("/");
  if (!owner || !name || rest.length > 0) return undefined;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs/${workflowRunId}`;
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
  if (!validScope(options.scope)) return { state: "not-found" };
  const runParameters: unknown[] = [runId];
  const runScopePredicate = options.scope ? " and repositories.installation_id = $2 and repositories.id = $3" : "";
  if (options.scope) runParameters.push(options.scope.installationId, options.scope.repositoryId);
  const runResult = await executor.query(
    `select
       release_runs.id,
       release_runs.status,
       release_runs.decision,
       release_runs.commit_sha,
       release_runs.ref,
       release_runs.pull_request_number,
       release_runs.trigger_kind,
       release_runs.trust_mode,
       release_runs.safe_mode_reasons,
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
       repositories.id as repository_id,
       repositories.installation_id,
       repositories.owner,
       repositories.name,
       repositories.private,
       repository_setup_revisions.preset as setup_preset,
       repository_setup_revisions.preset_version as setup_preset_version,
       repository_setup_revisions.revision as setup_revision,
       repository_setup_revisions.workflow_contract_version as setup_workflow_contract_version,
       repository_setup_revisions.workflow_status as setup_workflow_status,
       repository_setup_revisions.config_status as setup_config_status,
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
     left join repository_setup_revisions
       on repository_setup_revisions.id = release_runs.repository_setup_revision_id
     where release_runs.id = $1${runScopePredicate}`,
    runParameters,
  );
  const runRow = rows(runResult)[0];
  if (!runRow) return { state: "not-found" };

  const repositoryId = uuidValue(runRow, "repository_id");
  const installationId = uuidValue(runRow, "installation_id");
  if (!repositoryId || !installationId) return { state: "not-found" };
  const repository: RunDashboardRepository = {
    id: repositoryId,
    installationId,
    owner: requiredString(runRow, "owner"),
    name: requiredString(runRow, "name"),
    private: repositoryPrivateValue(runRow, "private"),
  };
  if (repository.private && !(await options.authorizeRepository?.(repository))) {
    return { state: "not-found" };
  }

  const findingScope = findingPredicates(runId, filters);
  const artifactScope = artifactPredicates(runId, filters);

  const [findingCountResult, artifactCountResult, attemptsResult, transitionsResult, boardsResult] = await Promise.all([
    executor.query(`select count(*)::int as total from findings where ${findingScope.sql}`, findingScope.parameters),
    executor.query(
      `select count(*)::int as total,
              coalesce((
                select count(*)::int
                from artifact_deletion_jobs
                where artifact_deletion_jobs.release_run_id = $1
                  and artifact_deletion_jobs.status = 'completed'
                  and artifact_deletion_jobs.deletion_outcome = 'deleted'
              ), 0)::int as deleted_artifact_count,
              coalesce((
                select count(*)::int
                from artifact_deletion_jobs
                where artifact_deletion_jobs.release_run_id = $1
                  and artifact_deletion_jobs.status = 'completed'
                  and artifact_deletion_jobs.deletion_outcome = 'missing'
              ), 0)::int as missing_artifact_count,
              coalesce((
                select count(*)::int
                from artifact_deletion_jobs
                where artifact_deletion_jobs.release_run_id = $1
                  and artifact_deletion_jobs.status in ('available', 'leased')
              ), 0)::int as pending_artifact_deletion_count,
              coalesce((
                select count(*)::int
                from artifact_deletion_jobs
                where artifact_deletion_jobs.release_run_id = $1
                  and artifact_deletion_jobs.status = 'dead_letter'
              ), 0)::int as failed_artifact_deletion_count
       from artifacts
       where ${artifactScope.sql}`,
      artifactScope.parameters,
    ),
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
    executor.query(
      `select boards.id as board_id,
              boards.project_path,
              boards.display_name,
              snapshot.captured_at,
              snapshot.component_count::int as component_count,
              count(component.id) filter (where component.mpn is not null)::int as identified_component_count,
              count(component.id) filter (where component.mpn is null)::int as unidentified_component_count,
              count(component.id) filter (
                where lower(component.lifecycle_at_capture) in ('eol', 'nrnd', 'obsolete', 'discontinued')
              )::int as risky_lifecycle_count
       from board_bom_snapshots as snapshot
       join boards on boards.id = snapshot.board_id
       left join board_bom_components as component on component.snapshot_id = snapshot.id
       where snapshot.run_id = $1
       group by boards.id, boards.project_path, boards.display_name, snapshot.captured_at, snapshot.component_count
       order by boards.project_path
       limit 50`,
      [runId],
    ),
  ]);

  const findingTotal = numberValue(rows(findingCountResult)[0] ?? {}, "total") ?? 0;
  const artifactCountRow = rows(artifactCountResult)[0] ?? {};
  const artifactTotal = numberValue(artifactCountRow, "total") ?? 0;
  const artifactLifecycle: ArtifactLifecycleSummary = {
    deleted: numberValue(artifactCountRow, "deleted_artifact_count") ?? 0,
    missing: numberValue(artifactCountRow, "missing_artifact_count") ?? 0,
    pendingDeletion: numberValue(artifactCountRow, "pending_artifact_deletion_count") ?? 0,
    failedDeletion: numberValue(artifactCountRow, "failed_artifact_deletion_count") ?? 0,
  };
  const findingsPage = pageInfo(filters.findingsPage, filters.pageSize, findingTotal);
  const artifactsPage = pageInfo(filters.artifactsPage, filters.pageSize, artifactTotal);
  const findingOffset = (findingsPage.page - 1) * filters.pageSize;
  const artifactOffset = (artifactsPage.page - 1) * filters.pageSize;

  const [findingsResult, artifactsResult, categoryBreakdownResult] = await Promise.all([
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
              artifacts.bytes, artifacts.role, artifacts.content_type,
              artifacts.execution_attempt_id, artifacts.retention_until, artifacts.uploaded_at
       from artifacts
       where ${artifactScope.sql}
       order by ${artifactOrder(filters.artifactSort)}
       limit $${artifactScope.parameters.length + 1}
       offset $${artifactScope.parameters.length + 2}`,
      [...artifactScope.parameters, filters.pageSize, artifactOffset],
    ),
    // Whole-run domain breakdown, independent of the findings table's own filter/pagination --
    // the score cards answer "what does this run look like overall", the table answers
    // "show me the filtered detail". lower(severity) equivalences mirror findingOrder() below.
    executor.query(
      `select coalesce(category, 'unclassified') as category,
              count(*)::int as total,
              count(*) filter (where lower(severity) in ('critical', 'error'))::int as critical,
              count(*) filter (where lower(severity) = 'high')::int as high,
              count(*) filter (where lower(severity) in ('medium', 'warning'))::int as medium,
              count(*) filter (where lower(severity) = 'low')::int as low,
              count(*) filter (where lower(severity) = 'info')::int as info
         from findings
        where run_id = $1
        group by coalesce(category, 'unclassified')
        order by coalesce(category, 'unclassified')`,
      [runId],
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

  const categoryBreakdown = rows(categoryBreakdownResult).map(
    (row): CategoryBreakdownEntry => ({
      category: requiredString(row, "category"),
      total: numberValue(row, "total") ?? 0,
      critical: numberValue(row, "critical") ?? 0,
      high: numberValue(row, "high") ?? 0,
      medium: numberValue(row, "medium") ?? 0,
      low: numberValue(row, "low") ?? 0,
      info: numberValue(row, "info") ?? 0,
    }),
  );

  const artifacts = rows(artifactsResult).map((row): ArtifactDetail => {
    const artifactId = requiredString(row, "id");
    const downloadUrl = options.artifactDownloadUrl?.({ runId, artifactId });
    const retentionUntil = stringValue(row, "retention_until");
    return {
      id: artifactId,
      kind: requiredString(row, "kind"),
      name: requiredString(row, "name"),
      sha256: requiredString(row, "sha256"),
      bytes: numberValue(row, "bytes") ?? 0,
      role: requiredString(row, "role"),
      contentType: stringValue(row, "content_type") ?? "application/octet-stream",
      executionAttemptId: stringValue(row, "execution_attempt_id"),
      uploadedAt: requiredString(row, "uploaded_at"),
      downloadUrl,
      availability: "available",
      retention: retentionUntil ? "retained-until" : "no-automatic-expiry",
      retentionUntil,
    };
  });

  const repositoryName = `${repository.owner}/${repository.name}`;
  const attempts = rows(attemptsResult).map((row): AttemptDetail => {
    const workflowDispatchId = stringValue(row, "github_workflow_dispatch_id");
    return {
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
      workflowDispatchId,
      workflowRunUrl: githubActionsRunUrl(repositoryName, workflowDispatchId),
      failureClass: stringValue(row, "failure_class"),
      failureMessage: stringValue(row, "failure_message"),
      resultDigest: stringValue(row, "result_digest"),
    };
  });

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

  const boards = rows(boardsResult).map(
    (row): RunBoardDetail => ({
      boardId: requiredString(row, "board_id"),
      project: requiredString(row, "project_path"),
      displayName: requiredString(row, "display_name"),
      capturedAt: requiredString(row, "captured_at"),
      componentCount: numberValue(row, "component_count") ?? 0,
      identifiedComponentCount: numberValue(row, "identified_component_count") ?? 0,
      unidentifiedComponentCount: numberValue(row, "unidentified_component_count") ?? 0,
      riskyLifecycleCount: numberValue(row, "risky_lifecycle_count") ?? 0,
    }),
  );

  const status = requiredString(runRow, "status");
  const reconciliationCount = numberValue(runRow, "reconciliation_count") ?? 0;
  const deadLetterCount = numberValue(runRow, "dead_letter_count") ?? 0;
  const resultContractVersion = numberValue(runRow, "contract_version");
  const lastActivityAt = stringValue(runRow, "last_activity_at");
  const trustMode: RunTrustMode = stringValue(runRow, "trust_mode") === "safe" ? "safe" : "standard";
  const safeModeReasons = trustMode === "safe" ? safeModeReasonsValue(runRow, "safe_mode_reasons") : [];
  const setupPreset = stringValue(runRow, "setup_preset");
  const setupPresetVersion = numberValue(runRow, "setup_preset_version");
  const setupRevision = numberValue(runRow, "setup_revision");
  const setupWorkflowContractVersion = numberValue(runRow, "setup_workflow_contract_version");
  const setupWorkflowStatus = stringValue(runRow, "setup_workflow_status");
  const setupConfigStatus = stringValue(runRow, "setup_config_status");
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
      repository: repositoryName,
      repositoryId: repository.id,
      repositoryPrivate: repository.private,
      trustMode,
      safeModeReasons,
      ...(setupPreset ? { setupPreset } : {}),
      ...(setupPresetVersion === undefined ? {} : { setupPresetVersion }),
      ...(setupRevision === undefined ? {} : { setupRevision }),
      ...(setupWorkflowContractVersion === undefined ? {} : { setupWorkflowContractVersion }),
      ...(setupWorkflowStatus ? { setupWorkflowStatus } : {}),
      ...(setupConfigStatus ? { setupConfigStatus } : {}),
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
      categoryBreakdown,
      artifacts,
      artifactsPage,
      artifactLifecycle,
      attempts,
      transitions,
      boards,
    },
  };
}

function buildDemoRun(runId: string, filters: RunDashboardFilters = {}): RunDetail {
  const isFailure = runId.includes("fail");
  const baseFindings: FindingDetail[] = [
    {
      id: "f-1",
      ruleId: "bom.missing-mpn",
      severity: isFailure ? "critical" : "high",
      message: "Capacitor C12 (0.1uF 50V 0603) has missing manufacturer part number in active BOM variant.",
      path: "hardware/power-stage.kicad_sch",
      kind: "bom",
      waivedAt: undefined,
    },
    {
      id: "f-2",
      ruleId: "manufacturing.polarity-markers",
      severity: "medium",
      message: "Diode D4 silk screen polarity dot is within 0.15mm of solder mask boundary.",
      path: "hardware/flight-controller.kicad_pcb",
      kind: "manufacturing",
      waivedAt: undefined,
    },
    {
      id: "f-3",
      ruleId: "design.copper-balance",
      severity: "medium",
      message: "Inner copper layer In1.Cu has 18% surface imbalance compared to In2.Cu.",
      path: "hardware/flight-controller.kicad_pcb",
      kind: "design",
      waivedAt: undefined,
    },
    {
      id: "f-4",
      ruleId: "firmware.stm32cubemx-pin-contract",
      severity: "low",
      message: "Pin PB6 (I2C1_SCL) declared as internal pull-up in CubeMX IOC but schematic has external 2.2k pull-up.",
      path: "firmware/ioc/board.ioc",
      kind: "firmware",
      waivedAt: undefined,
    },
    {
      id: "f-5",
      ruleId: "pinmap.collision",
      severity: "info",
      message: "SWD header debug connector shares test point TP3 with SPI1_MOSI.",
      path: "hardware/debug.kicad_sch",
      kind: "pinmap",
      waivedAt: undefined,
    },
  ];

  const search = filters.findingSearch?.toLowerCase() ?? "";
  const severityFilter = filters.findingSeverity?.toLowerCase();
  const filteredFindings = baseFindings.filter((finding) => {
    if (severityFilter && finding.severity.toLowerCase() !== severityFilter) return false;
    if (search && !finding.ruleId.toLowerCase().includes(search) && !finding.message.toLowerCase().includes(search)) {
      return false;
    }
    return true;
  });

  const baseArtifacts: ArtifactDetail[] = [
    {
      id: "art-1",
      kind: "report",
      name: "boardreadyops.report.html",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      bytes: 148520,
      role: "primary",
      contentType: "text/html",
      executionAttemptId: "att-1",
      uploadedAt: "2026-08-23T18:01:20.000Z",
      downloadUrl: "#",
      availability: "available",
      retention: "no-automatic-expiry",
      retentionUntil: undefined,
    },
    {
      id: "art-2",
      kind: "findings",
      name: "findings.json",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      bytes: 12450,
      role: "evidence",
      contentType: "application/json",
      executionAttemptId: "att-1",
      uploadedAt: "2026-08-23T18:01:21.000Z",
      downloadUrl: "#",
      availability: "available",
      retention: "no-automatic-expiry",
      retentionUntil: undefined,
    },
    {
      id: "art-3",
      kind: "bom",
      name: "hbom.csv",
      sha256: "486ea46224d104cedcb0f97f6bef2357cc7379c617e202b364f0ddd032b29a56",
      bytes: 38200,
      role: "evidence",
      contentType: "text/csv",
      executionAttemptId: "att-1",
      uploadedAt: "2026-08-23T18:01:22.000Z",
      downloadUrl: "#",
      availability: "available",
      retention: "no-automatic-expiry",
      retentionUntil: undefined,
    },
    {
      id: "art-4",
      kind: "manufacturing",
      name: "gerber_fabrication_pack.zip",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      bytes: 2840500,
      role: "output",
      contentType: "application/zip",
      executionAttemptId: "att-1",
      uploadedAt: "2026-08-23T18:01:23.000Z",
      downloadUrl: "#",
      availability: "available",
      retention: "retained-until",
      retentionUntil: "2026-11-23T18:01:23.000Z",
    },
  ];

  return {
    id: runId,
    status: isFailure ? "failed" : "completed",
    decision: isFailure ? "fail" : "pass",
    commitSha: "f8a92b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
    ref: "refs/pull/42/head",
    pullRequestNumber: 42,
    triggerKind: "pull_request",
    startedAt: "2026-08-23T18:00:00.000Z",
    completedAt: "2026-08-23T18:01:25.000Z",
    durationMs: 85_000,
    boardReadyOpsVersion: "1.24.0",
    kicadVersion: "9.0.0",
    githubCheckRunId: "987654321",
    readinessScore: isFailure ? 42 : 94,
    resultContractVersion: 1,
    conclusion: isFailure ? "failure" : "success",
    metrics: {
      readinessScore: isFailure ? 42 : 94,
      criticalFindings: isFailure ? 1 : 0,
      highFindings: 1,
      mediumFindings: 2,
      lowFindings: 1,
      totalRulesEvaluated: 32,
    },
    reportLinks: [{ label: "Hardware Summary", url: "https://boardreadyops.example/runs/demo/artifacts/art-1" }],
    lastPublicationAttemptAt: "2026-08-23T18:01:26.000Z",
    githubCheckPublishedAt: "2026-08-23T18:01:27.000Z",
    githubCommentPublishedAt: undefined,
    lastPublicationError: undefined,
    repository: "boardreadyops/drone-flight-controller",
    repositoryId: "demo-repo-drone-flight-controller",
    repositoryPrivate: false,
    trustMode: "standard",
    safeModeReasons: [],
    setupPreset: "production-release",
    setupPresetVersion: 2,
    setupRevision: 4,
    setupWorkflowContractVersion: 1,
    setupWorkflowStatus: "synced",
    setupConfigStatus: "valid",
    investigationState: isFailure ? "failed" : "completed",
    reconciliationCount: 0,
    deadLetterCount: 0,
    lastActivityAt: "2026-08-23T18:01:25.000Z",
    findings: filteredFindings,
    findingsPage: { page: 1, pageSize: 25, total: filteredFindings.length, totalPages: 1 },
    categoryBreakdown: [],
    artifacts: baseArtifacts,
    artifactsPage: { page: 1, pageSize: 25, total: baseArtifacts.length, totalPages: 1 },
    artifactLifecycle: { deleted: 0, missing: 0, pendingDeletion: 0, failedDeletion: 0 },
    attempts: [
      {
        id: "att-1",
        attemptNumber: 1,
        status: isFailure ? "failed" : "completed",
        createdAt: "2026-08-23T18:00:00.000Z",
        dispatchRequestedAt: "2026-08-23T18:00:01.000Z",
        dispatchedAt: "2026-08-23T18:00:02.000Z",
        startedAt: "2026-08-23T18:00:05.000Z",
        heartbeatAt: "2026-08-23T18:01:20.000Z",
        completedAt: "2026-08-23T18:01:25.000Z",
        retryAfterAt: undefined,
        workflowDispatchId: "128492019",
        workflowRunUrl: "https://github.com/boardreadyops/drone-flight-controller/actions/runs/128492019",
        failureClass: isFailure ? "HardVerificationFailure" : undefined,
        failureMessage: isFailure ? "Critical BOM rule violated: missing manufacturer part number." : undefined,
        resultDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ],
    transitions: [
      {
        entityType: "release_run",
        executionAttemptId: "att-1",
        fromStatus: "running",
        toStatus: isFailure ? "failed" : "completed",
        fromVersion: 2,
        toVersion: 3,
        reasonCode: isFailure ? "terminal_failure" : "terminal_success",
        occurredAt: "2026-08-23T18:01:25.000Z",
      },
      {
        entityType: "execution_attempt",
        executionAttemptId: "att-1",
        fromStatus: "leased",
        toStatus: isFailure ? "failed" : "completed",
        fromVersion: 1,
        toVersion: 2,
        reasonCode: "result_recorded",
        occurredAt: "2026-08-23T18:01:24.000Z",
      },
    ],
    // Two boards, one carrying a part already at lifecycle risk, so the demo shows what the
    // supply signals look like rather than an empty panel.
    boards: [
      {
        boardId: "demo-board-mainboard",
        project: "hardware/mainboard/mainboard.kicad_pro",
        displayName: "mainboard",
        capturedAt: "2026-08-23T18:01:23.000Z",
        componentCount: 148,
        identifiedComponentCount: 141,
        unidentifiedComponentCount: 7,
        riskyLifecycleCount: isFailure ? 3 : 1,
      },
      {
        boardId: "demo-board-sensor",
        project: "hardware/sensor/sensor.kicad_pro",
        displayName: "sensor",
        capturedAt: "2026-08-23T18:01:23.000Z",
        componentCount: 32,
        identifiedComponentCount: 32,
        unidentifiedComponentCount: 0,
        riskyLifecycleCount: 0,
      },
    ],
  };
}

export async function loadRunDashboard(
  runId: string,
  environment: RunDashboardEnvironment = process.env,
  filters: RunDashboardFilters = {},
  dependencies: RunDashboardLoaderDependencies = defaultRunDashboardLoaderDependencies,
): Promise<RunLookupResult> {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    const isDevOrTest = environment.NODE_ENV === "development" || environment.NODE_ENV === "test";
    if (isDevOrTest && runId.startsWith("demo")) {
      return { state: "found", run: buildDemoRun(runId, filters) };
    }
    return { state: "not-configured" };
  }

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
      ...(dependencies.authorizeRepository ? { authorizeRepository: dependencies.authorizeRepository } : {}),
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
