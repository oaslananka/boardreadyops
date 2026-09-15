import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

/**
 * Append-only firmware dependency snapshots, scoped to a repository at a commit.
 *
 * Deliberately not board-scoped: `captureFirmwareSnapshot` globs the whole tree and the record it
 * produces carries a manifest path and no project association, so there is no board fact to
 * record. Guessing one from directory layout would put an invented board list into a CRA report
 * with nothing marking it as invented. See the decision on #798.
 *
 * Structural mirror of the contract's firmware record, declared here rather than imported so this
 * package keeps its independence from `@boardreadyops/contracts`; the caller validates against the
 * Zod schema before reaching the store.
 */
export type FirmwareDependencyInput = {
  name: string;
  manifestPath: string;
  origin: "registry" | "git" | "local" | "framework";
  versionSpec?: string | undefined;
  pinned?: boolean | undefined;
  purl?: string | undefined;
  cpe?: string | undefined;
  searchable?: boolean | undefined;
  identitySource?: string | undefined;
};

export type RecordFirmwareSnapshotInput = {
  runId: string;
  repositoryId: string;
  commitSha: string;
  dependencies: readonly FirmwareDependencyInput[];
};

export type RecordFirmwareSnapshotResult = {
  snapshotsWritten: number;
  dependenciesWritten: number;
  /** How many carried an identifier a vulnerability database indexes. Usually far fewer. */
  searchableWritten: number;
  /** False when the run does not belong to the repository, so nothing was written. */
  runMatched: boolean;
};

export type FirmwareSnapshotStore = {
  recordSnapshot(input: RecordFirmwareSnapshotInput): Promise<RecordFirmwareSnapshotResult>;
};

type StoreOptions = {
  now?: (() => Date) | undefined;
};

/**
 * An identifier is only stored on a dependency that claims to be searchable.
 *
 * The database refuses the other combinations outright, and this keeps a caller from tripping that
 * constraint on data that is merely inconsistent rather than malicious: the two states must never
 * be confusable, so one of them wins rather than both being written.
 */
function identifiersFor(dependency: FirmwareDependencyInput): { purl: string | null; cpe: string | null } {
  if (dependency.searchable !== true) return { purl: null, cpe: null };
  return { purl: dependency.purl ?? null, cpe: dependency.cpe ?? null };
}

export function createSqlFirmwareSnapshotStore(
  executor: SqlQueryExecutor,
  options: StoreOptions = {},
): FirmwareSnapshotStore {
  const now = options.now ?? (() => new Date());

  return {
    async recordSnapshot(input) {
      if (input.dependencies.length === 0) {
        // Nothing to record is not a failure. A repository with no firmware gets no snapshot
        // rather than an empty one, so a reader can tell "no firmware here" from "firmware with
        // nothing in it" -- the same distinction RunResult.firmware draws by being absent.
        return { snapshotsWritten: 0, dependenciesWritten: 0, searchableWritten: 0, runMatched: true };
      }

      const payload = input.dependencies.map((dependency) => {
        const { purl, cpe } = identifiersFor(dependency);
        return {
          name: dependency.name,
          manifest_path: dependency.manifestPath,
          origin: dependency.origin,
          version_spec: dependency.versionSpec ?? null,
          pinned: dependency.pinned === true,
          purl,
          cpe,
          // Searchable only when an identifier survived, so the stored flag and the stored
          // identifier can never disagree.
          searchable: purl !== null || cpe !== null,
          identity_source: dependency.identitySource ?? null,
        };
      });

      const result = await executor.query(
        `with run_scope as (
           select release_runs.id as run_id, release_runs.repository_id
           from release_runs
           where release_runs.id = $1
             and release_runs.repository_id = $2
         ),
         payload as (
           select entry.*
           from jsonb_to_recordset($4::jsonb) as entry(
             name text,
             manifest_path text,
             origin text,
             version_spec text,
             pinned boolean,
             purl text,
             cpe text,
             searchable boolean,
             identity_source text
           )
         ),
         inserted_snapshot as (
           insert into repository_firmware_snapshots (
             repository_id, run_id, commit_sha, dependency_count, searchable_count, captured_at
           )
           select run_scope.repository_id,
                  run_scope.run_id,
                  $3,
                  (select count(*) from payload),
                  (select count(*) from payload where payload.searchable),
                  $5::timestamptz
           from run_scope
           on conflict (repository_id, run_id) do nothing
           returning repository_firmware_snapshots.id
         ),
         inserted_dependencies as (
           insert into repository_firmware_dependencies (
             snapshot_id, name, manifest_path, origin, version_spec,
             pinned, purl, cpe, searchable, identity_source
           )
           select inserted_snapshot.id,
                  payload.name,
                  payload.manifest_path,
                  payload.origin,
                  payload.version_spec,
                  coalesce(payload.pinned, false),
                  payload.purl,
                  payload.cpe,
                  coalesce(payload.searchable, false),
                  payload.identity_source
           from inserted_snapshot
           cross join payload
           returning repository_firmware_dependencies.id, repository_firmware_dependencies.searchable
         )
         select (select count(*) from inserted_snapshot)::int as snapshots_written,
                (select count(*) from inserted_dependencies)::int as dependencies_written,
                (select count(*) from inserted_dependencies where inserted_dependencies.searchable)::int
                  as searchable_written,
                (select count(*) from run_scope)::int as run_matches`,
        [input.runId, input.repositoryId, input.commitSha, JSON.stringify(payload), now().toISOString()],
      );

      const row = rows(result)[0];
      return {
        snapshotsWritten: numberCell(row, "snapshots_written"),
        dependenciesWritten: numberCell(row, "dependencies_written"),
        searchableWritten: numberCell(row, "searchable_written"),
        runMatched: numberCell(row, "run_matches") > 0,
      };
    },
  };
}

/** The executor's return is untyped by design; narrow it the same way board-bom-store does. */
function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function numberCell(row: Record<string, unknown> | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
