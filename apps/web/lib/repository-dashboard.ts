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

type RepositorySummary = {
  id: string;
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
};

export type RepositoryGroup = {
  accountLogin: string;
  repositories: RepositorySummary[];
};

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

const repositorySummaryQuery = `
  with visible as (
    select repositories.id,
           repositories.owner,
           repositories.name,
           repositories.private,
           installations.account_login,
           installations.github_installation_id
      from repositories
      join installations on installations.id = repositories.installation_id
     where installations.github_installation_id = any($1::bigint[])
       and repositories.disabled_at is null
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
         coalesce(nullif(visible.account_login, ''), visible.owner) as account_login,
         latest.run_id,
         latest.status,
         latest.decision,
         latest.started_at,
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
      if (!id || !owner || !name) continue;
      const accountLogin = text(row, "account_login") ?? owner;

      const summary: RepositorySummary = {
        id,
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
            detectedAt: text(row, "detected_at"),
          },
        ];
      }),
    };
  } finally {
    await executor.close();
  }
}
