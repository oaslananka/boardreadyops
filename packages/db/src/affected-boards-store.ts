import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * Answers the reverse of the supply watch: given a part, which boards contain it.
 *
 * The watch runs board-first -- claim a due board, evaluate its BOM, raise findings against it.
 * That is the right shape for a scan, and the wrong shape for the alert the scan exists to
 * produce. When a part goes NRND, or a CVE lands on a component, the question is not "what should
 * I check next" but "which of the boards I have already shipped contain this, and am I about to
 * build one of them again". Nothing could answer that.
 *
 * One resolution, two triggers. #449 needs it for lifecycle and availability; #755 needs the same
 * answer inside the CRA's twenty-four hour reporting window, with a security trigger instead. The
 * expensive part is the relationship between a part and a shipped revision, and it is identical
 * either way.
 *
 * Tenant scope derives through board -> repository -> installation, as `board_supply_watch` does.
 * Every query here takes an installation and joins through it; a part identity is a fact about the
 * world, but which of your boards contains it is not.
 */

export type AffectedPartKey = {
  mpn: string;
  manufacturer?: string | undefined;
};

export type AffectedBoard = {
  boardId: string;
  displayName: string;
  projectPath: string;
  repositoryId: string;
  repositoryFullName: string;
  /** The most recent snapshot of this board that contains the part. */
  snapshotId: string;
  commitSha: string;
  capturedAt: string;
  /** References the part occupies on that snapshot, so a reader can find it on the board. */
  references: readonly string[];
  /**
   * Whether the board's *current* snapshot contains it.
   *
   * False means the part was in a revision that has since been superseded: still relevant to a
   * product in the field, and not something a reorder is about to buy. Collapsing the two would
   * either raise alarms about parts a team designed out months ago, or miss a device already
   * shipped -- and for the CRA it is the shipped one that has to be reported.
   */
  inCurrentRevision: boolean;
};

export type AffectedBoardsResult = {
  boards: readonly AffectedBoard[];
  /** True when more boards matched than the limit allowed, so a caller never reports a partial set as complete. */
  truncated: boolean;
};

export type AffectedBoardsStore = {
  resolveAffectedBoards(
    installationId: string,
    parts: readonly AffectedPartKey[],
    options?: { limit?: number | undefined },
  ): Promise<AffectedBoardsResult>;
};

const defaultLimit = 200;
const maximumLimit = 1000;

type Row = Record<string, unknown>;

function rows(result: unknown): readonly Row[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Row[]) : [];
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new Error(`expected column ${key}`);
}

function timestampText(row: Row, key: string): string {
  const value = row[key];
  // node-postgres decodes timestamptz to a Date; a mocked executor may hand back a string.
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new Error(`expected timestamp column ${key}`);
}

function references(row: Row, key: string): readonly string[] {
  const value = row[key];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return [];
}

export function createSqlAffectedBoardsStore(executor: SqlQueryExecutor): AffectedBoardsStore {
  return {
    async resolveAffectedBoards(installationId, parts, options) {
      if (parts.length === 0) return { boards: [], truncated: false };

      const limit = Math.min(Math.max(options?.limit ?? defaultLimit, 1), maximumLimit);
      // Matching is case-insensitive on MPN, and on manufacturer only when the caller gave one:
      // a lifecycle notice frequently names the part without naming who makes it, and dropping
      // those matches would silently under-report.
      const mpns = parts.map((part) => part.mpn.toLowerCase());
      const manufacturers = parts.map((part) => part.manufacturer?.toLowerCase() ?? null);

      const result = await executor.query(
        // Deliberately built from plain grouping and a ranked CTE rather than `distinct on`
        // combined with a window function. The two interact in ways that are easy to get subtly
        // wrong, and this query decides what gets reported to a regulator under #755.
        `with wanted as (
           select * from unnest($2::text[], $3::text[]) as part(mpn, manufacturer)
         ),
         -- The newest snapshot per board, so "is this still what we build" is answerable without
         -- a second round trip.
         current_snapshot as (
           select board_id, max(captured_at) as captured_at
             from board_bom_snapshots
            group by board_id
         ),
         hits as (
           select boards.id            as board_id,
                  boards.display_name  as display_name,
                  boards.project_path  as project_path,
                  repositories.id      as repository_id,
                  repositories.owner || '/' || repositories.name as repository_full_name,
                  snapshots.id         as snapshot_id,
                  snapshots.commit_sha as commit_sha,
                  snapshots.captured_at as captured_at,
                  array_agg(distinct components.reference order by components.reference) as refs
             from board_bom_components as components
             join board_bom_snapshots as snapshots on snapshots.id = components.snapshot_id
             join boards on boards.id = snapshots.board_id
             join repositories on repositories.id = boards.repository_id
             join wanted
               on lower(components.mpn) = wanted.mpn
              and (wanted.manufacturer is null or lower(coalesce(components.manufacturer, '')) = wanted.manufacturer)
            where repositories.installation_id = $1
              and boards.archived_at is null
              and components.mpn is not null
              and components.dnp = false
            group by boards.id, boards.display_name, boards.project_path, repositories.id,
                     repositories.owner, repositories.name, snapshots.id, snapshots.commit_sha,
                     snapshots.captured_at
         ),
         ranked as (
           select hits.*,
                  row_number() over (partition by hits.board_id order by hits.captured_at desc, hits.snapshot_id desc) as rank,
                  hits.captured_at = current_snapshot.captured_at as in_current_revision
             from hits
             join current_snapshot on current_snapshot.board_id = hits.board_id
         )
         select board_id, display_name, project_path, repository_id, repository_full_name,
                snapshot_id, commit_sha, captured_at, refs, in_current_revision
           from ranked
          where rank = 1
          order by in_current_revision desc, captured_at desc, board_id
          limit $4`,
        [installationId, mpns, manufacturers, limit + 1],
      );

      const found = rows(result);
      const boards = found.slice(0, limit).map((row) => ({
        boardId: text(row, "board_id"),
        displayName: text(row, "display_name"),
        projectPath: text(row, "project_path"),
        repositoryId: text(row, "repository_id"),
        repositoryFullName: text(row, "repository_full_name"),
        snapshotId: text(row, "snapshot_id"),
        commitSha: text(row, "commit_sha"),
        capturedAt: timestampText(row, "captured_at"),
        references: references(row, "refs"),
        inCurrentRevision: row.in_current_revision === true,
      }));

      // One row over the limit was requested so truncation is known rather than guessed.
      return { boards, truncated: found.length > limit };
    },
  };
}
