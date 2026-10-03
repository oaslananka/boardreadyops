import { notCancelledSubscription } from "./tenant-scope.js";
import type { UserSession } from "./user-session.js";

/**
 * The repositories a signed-in viewer can see, and the state of each.
 *
 * Until this existed a customer had nowhere to go after installing: runs were reachable only
 * when GitHub handed them the link from a Check Run, and nothing listed what BoardReadyOps was
 * watching. This is the entry point that makes the product browsable.
 *
 * Every query is scoped by the session's installation ids rather than by anything in the
 * request, so a repository the viewer cannot administer is not merely hidden from the page —
 * it is never selected.
 */

export type RepositorySummary = {
  id: string;
  /** Internal installation id; what every control-plane store and route is keyed by. */
  installationId: string;
  /** GitHub's installation id; what an installation access token and its grants are minted from. */
  githubInstallationId: number;
  accountLogin: string;
  owner: string;
  name: string;
  private: boolean;
  latestRunId: string | undefined;
  latestRunStatus: string | undefined;
  latestRunDecision: string | undefined;
  latestRunAt: string | undefined;
  /** Findings on the newest run only; older runs describe commits nobody is shipping. */
  openFindings: number;
  watchedBoards: number;
  openSupplyFindings: number;
  /** Latest persisted repository setup revision, if onboarding has started. */
  setupRevision?: number;
  setupPreset?: string;
  setupWorkflowStatus?: string;
  setupConfigStatus?: string;
  setupObservedSha?: string;
  setupProbeId?: string;
  setupProbeStatus?: string;
  setupProbeWorkflowRunId?: string;
  setupProbeExpiresAt?: string;
};

export type RepositoryGroup = {
  accountLogin: string;
  repositories: RepositorySummary[];
};

export type DashboardRepositorySummary = {
  repositories: number;
  repositoriesWithOpenFindings: number;
  supplyAlerts: number;
  repositoriesWithoutRuns: number;
  watchedBoards: number;
};

export function summarizeViewerRepositories(groups: readonly RepositoryGroup[]): DashboardRepositorySummary {
  const repositories = groups.flatMap((group) => group.repositories);
  return {
    repositories: repositories.length,
    repositoriesWithOpenFindings: repositories.filter((repository) => repository.openFindings > 0).length,
    supplyAlerts: repositories.reduce((sum, repository) => sum + repository.openSupplyFindings, 0),
    repositoriesWithoutRuns: repositories.filter((repository) => !repository.latestRunId).length,
    watchedBoards: repositories.reduce((sum, repository) => sum + repository.watchedBoards, 0),
  };
}

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function count(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(row: Record<string, unknown>, name: string): number | undefined {
  const value = row[name];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

const repositorySummaryQuery = `
  with visible as (
    select repositories.id,
           repositories.owner,
           repositories.name,
           repositories.private,
           repositories.installation_id,
           installations.account_login,
           installations.github_installation_id,
           setup.revision as setup_revision,
           setup.preset as setup_preset,
           setup.workflow_status as setup_workflow_status,
           setup.config_status as setup_config_status,
           setup.observed_sha as setup_observed_sha,
           setup_probe.id as setup_probe_id,
           setup_probe.status as setup_probe_status,
           setup_probe.workflow_run_id as setup_probe_workflow_run_id,
           setup_probe.expires_at as setup_probe_expires_at
      from repositories
      join installations on installations.id = repositories.installation_id
      left join repository_setup_revisions as setup
        on setup.id = repositories.current_setup_revision_id
      left join lateral (
        select probe.id,
               probe.status,
               probe.workflow_run_id,
               probe.expires_at
          from repository_setup_probes as probe
         where probe.installation_id = repositories.installation_id
           and probe.repository_id = repositories.id
           and probe.setup_revision_id = repositories.current_setup_revision_id
         order by probe.created_at desc, probe.id desc
         limit 1
      ) as setup_probe on true
     where installations.github_installation_id = any($1::bigint[])
       and repositories.disabled_at is null
       and installations.suspended_at is null
       and ${notCancelledSubscription}
  ),
  latest as (
    select distinct on (release_runs.repository_id)
           release_runs.repository_id,
           release_runs.id as run_id,
           release_runs.status,
           release_runs.decision,
           release_runs.started_at
      from release_runs
      join visible on visible.id = release_runs.repository_id
     order by release_runs.repository_id, release_runs.started_at desc, release_runs.id desc
  )
  select visible.id,
         visible.owner,
         visible.name,
         visible.private,
         visible.installation_id,
         visible.github_installation_id,
         coalesce(nullif(visible.account_login, ''), visible.owner) as account_login,
         latest.run_id,
         latest.status,
         latest.decision,
         latest.started_at,
         visible.setup_revision,
         visible.setup_preset,
         visible.setup_workflow_status,
         visible.setup_config_status,
         visible.setup_observed_sha,
         visible.setup_probe_id,
         visible.setup_probe_status,
         visible.setup_probe_workflow_run_id,
         visible.setup_probe_expires_at,
         -- Waived findings are a decision someone already made; counting them would keep
         -- showing work that is closed.
         (select count(*) from findings
           where findings.run_id = latest.run_id and findings.waived_at is null)::int as open_findings,
         (select count(*) from boards
            join board_supply_watch on board_supply_watch.board_id = boards.id
           where boards.repository_id = visible.id and boards.archived_at is null)::int as watched_boards,
         (select count(*) from board_supply_findings
            join boards on boards.id = board_supply_findings.board_id
           where boards.repository_id = visible.id
             and board_supply_findings.resolved_at is null)::int as open_supply_findings
    from visible
    left join latest on latest.repository_id = visible.id
   order by account_login, visible.owner, visible.name`;

/**
 * Groups the viewer's repositories by the account that owns them.
 *
 * Grouped rather than nested behind an installation picker: most customers have one
 * installation and should not click through a list of one, while somebody with a personal and
 * an organisation account still sees which is which.
 */
export async function loadViewerRepositories(
  session: UserSession | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RepositoryGroup[]> {
  if (!session || session.installationIds.length === 0) return [];
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return [];

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const result = await executor.query(repositorySummaryQuery, [session.installationIds]);
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];

    const groups = new Map<string, RepositoryGroup>();
    for (const row of rows) {
      const id = text(row, "id");
      const owner = text(row, "owner");
      const name = text(row, "name");
      const installationId = text(row, "installation_id");
      if (!id || !owner || !name || !installationId) continue;
      const accountLogin = text(row, "account_login") ?? owner;
      const setupRevision = integer(row, "setup_revision");
      const setupPreset = text(row, "setup_preset");
      const setupWorkflowStatus = text(row, "setup_workflow_status");
      const setupConfigStatus = text(row, "setup_config_status");
      const setupObservedSha = text(row, "setup_observed_sha");
      const setupProbeId = text(row, "setup_probe_id");
      const setupProbeStatus = text(row, "setup_probe_status");
      const setupProbeWorkflowRunId = text(row, "setup_probe_workflow_run_id");
      const setupProbeExpiresAt = text(row, "setup_probe_expires_at");

      const summary: RepositorySummary = {
        id,
        installationId,
        // node-postgres decodes bigint as a string to avoid precision loss.
        githubInstallationId: count(row, "github_installation_id"),
        accountLogin,
        owner,
        name,
        private: row.private === true,
        latestRunId: text(row, "run_id"),
        latestRunStatus: text(row, "status"),
        latestRunDecision: text(row, "decision"),
        latestRunAt: text(row, "started_at"),
        openFindings: count(row, "open_findings"),
        watchedBoards: count(row, "watched_boards"),
        openSupplyFindings: count(row, "open_supply_findings"),
        ...(setupRevision === undefined ? {} : { setupRevision }),
        ...(setupPreset ? { setupPreset } : {}),
        ...(setupWorkflowStatus ? { setupWorkflowStatus } : {}),
        ...(setupConfigStatus ? { setupConfigStatus } : {}),
        ...(setupObservedSha ? { setupObservedSha } : {}),
        ...(setupProbeId ? { setupProbeId } : {}),
        ...(setupProbeStatus ? { setupProbeStatus } : {}),
        ...(setupProbeWorkflowRunId ? { setupProbeWorkflowRunId } : {}),
        ...(setupProbeExpiresAt ? { setupProbeExpiresAt } : {}),
      };

      const group = groups.get(accountLogin) ?? { accountLogin, repositories: [] };
      group.repositories.push(summary);
      groups.set(accountLogin, group);
    }

    return [...groups.values()];
  } finally {
    await executor.close();
  }
}

type RepositoryRun = {
  id: string;
  status: string;
  decision: string | undefined;
  commitSha: string;
  ref: string;
  pullRequestNumber: number | undefined;
  startedAt: string | undefined;
  findingCount: number;
};

export type RepositoryDetail = {
  repository: RepositorySummary;
  runs: RepositoryRun[];
  supplyFindings: {
    boardPath: string;
    mpn: string;
    manufacturer: string | undefined;
    reference: string | undefined;
    status: string;
    severity: string;
    source: string | undefined;
    detectedAt: string | undefined;
  }[];
};

const runHistoryLimit = 20;

/**
 * One repository's recent runs and open supply findings.
 *
 * Returns undefined when the repository is not among the viewer's, which is the same answer a
 * caller gets for a repository that does not exist. A viewer cannot tell the two apart, so the
 * page cannot be used to probe for repositories.
 */
export async function loadRepositoryDetail(
  repositoryId: string,
  session: UserSession | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RepositoryDetail | undefined> {
  if (!session || session.installationIds.length === 0) return undefined;
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return undefined;

  const groups = await loadViewerRepositories(session, environment);
  const repository = groups.flatMap((group) => group.repositories).find((entry) => entry.id === repositoryId);
  if (!repository) return undefined;

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const runsResult = await executor.query(
      `select release_runs.id,
              release_runs.status,
              release_runs.decision,
              release_runs.commit_sha,
              release_runs.ref,
              release_runs.pull_request_number,
              release_runs.started_at,
              (select count(*) from findings
                where findings.run_id = release_runs.id and findings.waived_at is null)::int as finding_count
         from release_runs
        where release_runs.repository_id = $1
        order by release_runs.started_at desc, release_runs.id desc
        limit $2`,
      [repositoryId, runHistoryLimit],
    );

    const supplyResult = await executor.query(
      `select boards.project_path,
              board_supply_findings.mpn,
              board_supply_findings.manufacturer,
              board_supply_findings.reference,
              board_supply_findings.status,
              board_supply_findings.severity,
              board_supply_findings.observation_source,
              board_supply_findings.detected_at
         from board_supply_findings
         join boards on boards.id = board_supply_findings.board_id
        where boards.repository_id = $1 and board_supply_findings.resolved_at is null
        order by board_supply_findings.detected_at desc
        limit 100`,
      [repositoryId],
    );

    const runRows = (runsResult as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const supplyRows = (supplyResult as { rows?: readonly Record<string, unknown>[] }).rows ?? [];

    return {
      repository,
      runs: runRows.flatMap((row): RepositoryRun[] => {
        const id = text(row, "id");
        if (!id) return [];
        const pullRequestNumber = row.pull_request_number;
        return [
          {
            id,
            status: text(row, "status") ?? "unknown",
            decision: text(row, "decision"),
            commitSha: text(row, "commit_sha") ?? "",
            ref: text(row, "ref") ?? "",
            pullRequestNumber: typeof pullRequestNumber === "number" ? pullRequestNumber : undefined,
            startedAt: text(row, "started_at"),
            findingCount: count(row, "finding_count"),
          },
        ];
      }),
      supplyFindings: supplyRows.flatMap((row) => {
        const mpn = text(row, "mpn");
        if (!mpn) return [];
        return [
          {
            boardPath: text(row, "project_path") ?? "",
            mpn,
            manufacturer: text(row, "manufacturer"),
            reference: text(row, "reference"),
            status: text(row, "status") ?? "unknown",
            severity: text(row, "severity") ?? "medium",
            source: text(row, "observation_source"),
            detectedAt: text(row, "detected_at"),
          },
        ];
      }),
    };
  } finally {
    await executor.close();
  }
}
