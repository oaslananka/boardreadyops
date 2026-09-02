import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

/**
 * Structural mirror of the contract's BOM component. Declared here rather than imported
 * so this package keeps its existing independence from `@boardreadyops/contracts`; the
 * caller validates against the Zod schema before reaching the store.
 */
export type BoardBomComponentInput = {
  reference: string;
  mpn?: string | undefined;
  manufacturer?: string | undefined;
  value?: string | undefined;
  footprint?: string | undefined;
  quantity?: number | undefined;
  dnp?: boolean | undefined;
  lifecycle?: string | undefined;
  identityKey?: string | undefined;
};

export type BoardBomInput = {
  project: string;
  components: readonly BoardBomComponentInput[];
};

export type RecordBoardBomSnapshotsInput = {
  runId: string;
  repositoryId: string;
  commitSha: string;
  boms: readonly BoardBomInput[];
  /**
   * How many boards this installation's plan may keep under supply watch.
   *
   * Required rather than defaulted: a caller that cannot resolve the plan must not silently
   * get unlimited watching. The limit itself is plan policy and lives in cloud-core, so only
   * the resolved number crosses into this layer.
   */
  watchedBoardLimit: number;
};

export type RecordBoardBomSnapshotsResult = {
  boardsTouched: number;
  snapshotsWritten: number;
  componentsWritten: number;
  /** Boards newly placed under supply watch; fewer than reported means the plan limit was hit. */
  boardsEnrolled: number;
};

/** One component reference on a board matching a queried MPN, from that board's latest snapshot. */
export type BoardBomExposureMatch = {
  reference: string;
  mpn: string;
  manufacturer?: string | undefined;
  quantity?: number | undefined;
};

/** A board whose most recent BOM snapshot references a queried MPN. */
export type BoardBomExposureEntry = {
  boardId: string;
  repositoryId: string;
  projectPath: string;
  displayName: string;
  snapshotId: string;
  capturedAt: string;
  matches: readonly BoardBomExposureMatch[];
};

export type BoardBomStore = {
  recordSnapshots(input: RecordBoardBomSnapshotsInput): Promise<RecordBoardBomSnapshotsResult>;
  /**
   * Boards in this installation whose *current* (latest snapshot) BOM references `mpn`,
   * case-insensitively -- e.g. "which of our boards use this now-recalled part". Deliberately
   * scoped to the latest snapshot per board, not every historical snapshot: exposure is a
   * question about what ships today, not what a board's BOM has ever contained.
   */
  findBoardsByMpn(installationId: string, mpn: string): Promise<readonly BoardBomExposureEntry[]>;
};

export type BoardBomStoreOptions = { now?: () => Date };

const maximumBoardsPerRun = 50;
const maximumComponentsPerBoard = 5000;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function integerColumn(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function text(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function required(row: Record<string, unknown>, key: string): string {
  const value = text(row, key);
  if (value === undefined) throw new Error(`expected column ${key}`);
  return value;
}

/** Last path segment without its extension, so `a/b/mainboard.kicad_pro` reads as `mainboard`. */
function displayNameFor(projectPath: string): string {
  const segment = projectPath.split("/").pop() ?? projectPath;
  const withoutExtension = segment.replace(/\.kicad_pro$/u, "");
  return (withoutExtension.length > 0 ? withoutExtension : segment).slice(0, 256);
}

export function createSqlBoardBomStore(executor: SqlQueryExecutor, options: BoardBomStoreOptions = {}): BoardBomStore {
  const now = options.now ?? (() => new Date());

  return {
    async recordSnapshots(input) {
      if (input.boms.length === 0) {
        return { boardsTouched: 0, snapshotsWritten: 0, componentsWritten: 0, boardsEnrolled: 0 };
      }
      if (input.boms.length > maximumBoardsPerRun) {
        throw new Error(`a release run may report at most ${maximumBoardsPerRun} boards`);
      }
      for (const bom of input.boms) {
        if (bom.components.length > maximumComponentsPerBoard) {
          throw new Error(`board ${bom.project} exceeds ${maximumComponentsPerBoard} components`);
        }
      }

      // Postgres rejects an ON CONFLICT DO UPDATE that touches the same row twice in one
      // command, so a run reporting the same project path more than once must collapse to
      // one entry before it reaches SQL. Last entry wins.
      const deduplicated = [...new Map<string, BoardBomInput>(input.boms.map((bom) => [bom.project, bom])).values()];

      const at = now().toISOString();
      const boardsJson = JSON.stringify(
        deduplicated.map((bom) => ({
          project_path: bom.project,
          display_name: displayNameFor(bom.project),
          components: bom.components.map((component) => ({
            reference: component.reference,
            mpn: component.mpn ?? null,
            manufacturer: component.manufacturer ?? null,
            value: component.value ?? null,
            footprint: component.footprint ?? null,
            quantity: component.quantity ?? null,
            dnp: component.dnp ?? false,
            lifecycle_at_capture: component.lifecycle ?? null,
            identity_key: component.identityKey ?? null,
          })),
        })),
      );

      const result = await executor.query(
        `with run_scope as (
           select release_runs.id as run_id,
                  release_runs.repository_id,
                  repositories.installation_id
           from release_runs
           join repositories on repositories.id = release_runs.repository_id
           where release_runs.id = $1
             and release_runs.repository_id = $2
         ),
         payload as (
           select entry.project_path, entry.display_name, entry.components
           from jsonb_to_recordset($4::jsonb) as entry(
             project_path text,
             display_name text,
             components jsonb
           )
         ),
         upserted_boards as (
           insert into boards (repository_id, project_path, display_name, first_seen_at, last_seen_at)
           select run_scope.repository_id, payload.project_path, payload.display_name, $5::timestamptz, $5::timestamptz
           from payload
           cross join run_scope
           on conflict (repository_id, project_path) do update
             set last_seen_at = greatest(boards.last_seen_at, excluded.last_seen_at),
                 display_name = excluded.display_name,
                 archived_at = null
           returning boards.id, boards.project_path
         ),
         enrolled_watch as (
           -- A board is only ever discovered here, so this is the one place that can enrol it
           -- in supply watch. Without it a board created after the watch migration would never
           -- become due and would silently go unwatched.
           --
           -- Enrolment is also the metered action: the plan limits how many boards are watched,
           -- not how many exist. Boards beyond the limit are still recorded here with their full
           -- BOM history, so raising the plan later starts watching them without having lost any
           -- evidence. Existing enrolments count across the whole installation, because that is
           -- the unit the plan is sold in.
           insert into board_supply_watch (board_id)
           select candidate.id
           from (
             select upserted_boards.id,
                    row_number() over (order by upserted_boards.project_path) as position
             from upserted_boards
             where not exists (
               select 1 from board_supply_watch existing where existing.board_id = upserted_boards.id
             )
           ) as candidate
           cross join run_scope
           where (
             select count(*)
             from board_supply_watch watched
             join boards on boards.id = watched.board_id
             join repositories on repositories.id = boards.repository_id
             where repositories.installation_id = run_scope.installation_id
           ) + candidate.position <= $6::int
           on conflict (board_id) do nothing
           returning board_id
         ),
         inserted_snapshots as (
           insert into board_bom_snapshots (board_id, run_id, commit_sha, component_count, captured_at)
           select upserted_boards.id,
                  run_scope.run_id,
                  $3,
                  jsonb_array_length(payload.components),
                  $5::timestamptz
           from upserted_boards
           join payload on payload.project_path = upserted_boards.project_path
           cross join run_scope
           on conflict (board_id, run_id) do nothing
           returning board_bom_snapshots.id, board_bom_snapshots.board_id
         ),
         inserted_components as (
           insert into board_bom_components (
             snapshot_id, reference, mpn, manufacturer, value,
             footprint, quantity, dnp, lifecycle_at_capture, identity_key
           )
           select inserted_snapshots.id,
                  component.reference,
                  component.mpn,
                  component.manufacturer,
                  component.value,
                  component.footprint,
                  component.quantity,
                  coalesce(component.dnp, false),
                  component.lifecycle_at_capture,
                  component.identity_key
           from inserted_snapshots
           join upserted_boards on upserted_boards.id = inserted_snapshots.board_id
           join payload on payload.project_path = upserted_boards.project_path
           cross join lateral jsonb_to_recordset(payload.components) as component(
             reference text,
             mpn text,
             manufacturer text,
             value text,
             footprint text,
             quantity integer,
             dnp boolean,
             lifecycle_at_capture text,
             identity_key text
           )
           returning board_bom_components.id
         )
         select (select count(*) from upserted_boards)::int as boards_touched,
                (select count(*) from inserted_snapshots)::int as snapshots_written,
                (select count(*) from inserted_components)::int as components_written,
                (select count(*) from enrolled_watch)::int as boards_enrolled,
                (select count(*) from run_scope)::int as run_matches`,
        [
          input.runId,
          input.repositoryId,
          input.commitSha,
          boardsJson,
          at,
          Math.max(0, Math.trunc(input.watchedBoardLimit)),
        ],
      );

      const row = rows(result)[0];
      if (integerColumn(row, "run_matches") === 0) {
        throw new Error("release run does not belong to the supplied repository");
      }

      return {
        boardsTouched: integerColumn(row, "boards_touched"),
        snapshotsWritten: integerColumn(row, "snapshots_written"),
        componentsWritten: integerColumn(row, "components_written"),
        boardsEnrolled: integerColumn(row, "boards_enrolled"),
      };
    },

    async findBoardsByMpn(installationId, mpn) {
      const trimmedMpn = mpn.trim();
      if (trimmedMpn.length === 0) {
        return [];
      }

      const result = await executor.query(
        `with scoped_boards as (
           select boards.id as board_id, boards.repository_id, boards.project_path, boards.display_name
           from boards
           join repositories on repositories.id = boards.repository_id
           where repositories.installation_id = $1
             and boards.archived_at is null
         ),
         newest as (
           select distinct on (snapshot.board_id)
                  snapshot.board_id, snapshot.id as snapshot_id, snapshot.captured_at
           from board_bom_snapshots as snapshot
           join scoped_boards on scoped_boards.board_id = snapshot.board_id
           order by snapshot.board_id, snapshot.captured_at desc, snapshot.id desc
         )
         select scoped_boards.board_id,
                scoped_boards.repository_id,
                scoped_boards.project_path,
                scoped_boards.display_name,
                newest.snapshot_id,
                newest.captured_at,
                jsonb_agg(
                  jsonb_build_object(
                    'reference', component.reference,
                    'mpn', component.mpn,
                    'manufacturer', component.manufacturer,
                    'quantity', component.quantity
                  )
                  order by component.reference
                ) as matches
         from newest
         join scoped_boards on scoped_boards.board_id = newest.board_id
         join board_bom_components as component
           on component.snapshot_id = newest.snapshot_id
          and lower(component.mpn) = lower($2)
         group by scoped_boards.board_id, scoped_boards.repository_id, scoped_boards.project_path,
                  scoped_boards.display_name, newest.snapshot_id, newest.captured_at
         order by scoped_boards.project_path`,
        [installationId, trimmedMpn],
      );

      return rows(result).map((row): BoardBomExposureEntry => {
        const raw = row.matches;
        const parsed = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : [];
        return {
          boardId: required(row, "board_id"),
          repositoryId: required(row, "repository_id"),
          projectPath: required(row, "project_path"),
          displayName: required(row, "display_name"),
          snapshotId: required(row, "snapshot_id"),
          capturedAt: new Date(row.captured_at as string | number | Date).toISOString(),
          matches: (parsed as Record<string, unknown>[]).map((match) => ({
            reference: String(match.reference ?? ""),
            mpn: String(match.mpn ?? ""),
            manufacturer: typeof match.manufacturer === "string" ? match.manufacturer : undefined,
            quantity: typeof match.quantity === "number" ? match.quantity : undefined,
          })),
        };
      });
    },
  };
}
