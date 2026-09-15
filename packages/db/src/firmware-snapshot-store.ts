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

/** One identifier worth asking a database about, and where it came from. */
export type ScannableDependency = {
  name: string;
  manifestPath: string;
  purl?: string | undefined;
  cpe?: string | undefined;
};

/** A repository due for advisory scanning, with its newest snapshot's searchable identifiers. */
export type DueFirmwareScan = {
  repositoryId: string;
  installationId: string;
  /**
   * `owner/name`, which is what a notification must show.
   *
   * Carried on the claim rather than resolved later because the query already joins
   * `repositories` for the installation id, so it costs nothing here and saves a lookup at
   * notification time. The supply path learned this the hard way: its event once rendered a raw
   * board UUID where the contract promises `acme/gateway`.
   */
  repositoryFullName: string;
  snapshotId: string;
  commitSha: string;
  /**
   * Only the dependencies carrying an identifier a database indexes.
   *
   * The rest are excluded before any query: OSV answers a `pkg:generic` lookup with `{}`, so
   * asking would spend a rate-limited budget to learn nothing and risk recording that empty
   * answer as clean.
   */
  scannable: readonly ScannableDependency[];
  /** How many dependencies the snapshot holds in total, including the unsearchable ones. */
  dependencyCount: number;
};

export type FirmwareScanOutcome =
  | "answered"
  | "rejected"
  | "unavailable"
  | "no_provider"
  | "nothing_searchable"
  | "failed";

export type FirmwareSnapshotStore = {
  recordSnapshot(input: RecordFirmwareSnapshotInput): Promise<RecordFirmwareSnapshotResult>;
  /** Repositories whose advisory scan is due. */
  claimDueScans(now: Date, limit: number): Promise<DueFirmwareScan[]>;
  /** Records the outcome and when to look again. */
  completeScan(input: {
    repositoryId: string;
    snapshotId: string;
    outcome: FirmwareScanOutcome;
    scannedAt: Date;
    nextDueAt: Date;
  }): Promise<void>;
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
         enrolled_watch as (
           -- A snapshot is only ever recorded here, so this is the one place that can enrol the
           -- repository for advisory scanning. Without it a repository whose firmware first
           -- appeared after the watch migration would never become due and would silently go
           -- unscanned -- which, given the scan is what turns an identifier into an answer,
           -- would leave the whole chain built and never used.
           --
           -- New dependency data makes it due immediately rather than waiting out the interval.
           insert into repository_firmware_advisory_watch (repository_id, next_due_at)
           select run_scope.repository_id, $5::timestamptz
           from run_scope
           where exists (select 1 from inserted_snapshot)
           on conflict (repository_id) do update
             set next_due_at = least(repository_firmware_advisory_watch.next_due_at, excluded.next_due_at),
                 enabled = true
           returning repository_firmware_advisory_watch.repository_id
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
         select (select count(*) from enrolled_watch)::int as repositories_enrolled,
                (select count(*) from inserted_snapshot)::int as snapshots_written,
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

    async claimDueScans(nowAt, limit) {
      if (limit <= 0) return [];
      const result = await executor.query(CLAIM_SQL, [nowAt.toISOString(), limit]);

      const claimed: DueFirmwareScan[] = [];
      for (const row of rows(result)) {
        const repositoryId = textCell(row, "repository_id");
        const installationId = textCell(row, "installation_id");
        const snapshotId = textCell(row, "snapshot_id");
        const commitSha = textCell(row, "commit_sha");
        const repositoryFullName = textCell(row, "repository_full_name");
        if (!repositoryId || !installationId || !snapshotId || !commitSha || !repositoryFullName) continue;
        claimed.push({
          repositoryId,
          installationId,
          repositoryFullName,
          snapshotId,
          commitSha,
          scannable: scannableFrom(row.scannable),
          dependencyCount: numberCell(row, "dependency_count"),
        });
      }
      return claimed;
    },

    async completeScan(input) {
      await executor.query(COMPLETE_SQL, [
        input.repositoryId,
        input.scannedAt.toISOString(),
        input.snapshotId,
        input.outcome,
        input.nextDueAt.toISOString(),
      ]);
    },
  };
}

/**
 * Reads the aggregated identifier rows, dropping anything that lost both identifiers.
 *
 * A row marked searchable always carries one of the two -- the database constraint in 0068
 * enforces it -- so a row with neither means the invariant broke. Skipping it beats querying on
 * an empty string and recording the answer.
 */
function scannableFrom(value: unknown): readonly ScannableDependency[] {
  if (!Array.isArray(value)) return [];
  const scannable: ScannableDependency[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : undefined;
    const manifestPath = typeof record.manifestPath === "string" ? record.manifestPath : undefined;
    if (name === undefined || manifestPath === undefined) continue;
    const purl = typeof record.purl === "string" ? record.purl : undefined;
    const cpe = typeof record.cpe === "string" ? record.cpe : undefined;
    if (purl === undefined && cpe === undefined) continue;
    scannable.push({
      name,
      manifestPath,
      ...(purl === undefined ? {} : { purl }),
      ...(cpe === undefined ? {} : { cpe }),
    });
  }
  return scannable;
}

const CLAIM_SQL = `with due as (
           select watch.repository_id
           from repository_firmware_advisory_watch as watch
           where watch.enabled
             and watch.next_due_at <= $1::timestamptz
           order by watch.next_due_at, watch.repository_id
           limit $2::int
         ),
         newest as (
           -- The latest snapshot per due repository. Scanning an older one would ask about
           -- dependencies the project has already moved off.
           select distinct on (snapshot.repository_id)
                  snapshot.id, snapshot.repository_id, snapshot.commit_sha, snapshot.dependency_count
           from repository_firmware_snapshots as snapshot
           join due on due.repository_id = snapshot.repository_id
           order by snapshot.repository_id, snapshot.captured_at desc, snapshot.id desc
         )
         select newest.repository_id,
                repositories.installation_id,
                repositories.owner || '/' || repositories.name as repository_full_name,
                newest.id as snapshot_id,
                newest.commit_sha,
                newest.dependency_count,
                coalesce(
                  (
                    select jsonb_agg(
                             jsonb_build_object(
                               'name', dependency.name,
                               'manifestPath', dependency.manifest_path,
                               'purl', dependency.purl,
                               'cpe', dependency.cpe
                             )
                             order by dependency.name, dependency.manifest_path
                           )
                    from repository_firmware_dependencies as dependency
                    where dependency.snapshot_id = newest.id
                      and dependency.searchable
                  ),
                  '[]'::jsonb
                ) as scannable
         from newest
         join repositories on repositories.id = newest.repository_id
         order by newest.repository_id`;

const COMPLETE_SQL = `update repository_firmware_advisory_watch
            set last_scanned_at = $2::timestamptz,
                last_scanned_snapshot_id = $3,
                last_outcome = $4,
                next_due_at = $5::timestamptz,
                consecutive_failures = case
                  when $4 in ('answered', 'nothing_searchable') then 0
                  else repository_firmware_advisory_watch.consecutive_failures + 1
                end
          where repository_id = $1`;

/** The executor's return is untyped by design; narrow it the same way board-bom-store does. */
function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function textCell(row: Record<string, unknown>, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
