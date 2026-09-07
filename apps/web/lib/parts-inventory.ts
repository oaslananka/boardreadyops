import { componentKey } from "@boardreadyops/cloud-core";
import { reviewFixturesEnabled } from "./review-listing.js";
import { notCancelledSubscription } from "./tenant-scope.js";
import type { UserSession } from "./user-session.js";

/**
 * The parts a viewer's boards currently use, with what is known about each one.
 *
 * Until now a part count was a number on the dashboard and nothing more: the BOM rows, the
 * lifecycle cache and the supply findings all existed, and nothing joined them into the question
 * an engineer actually asks -- "which parts am I exposed on, and on which boards".
 *
 * **Current** BOM, not historical. Each board contributes only its latest snapshot, so a part
 * removed two revisions ago stops appearing. A page that listed every part ever seen would grow
 * without bound and stop meaning anything.
 *
 * The tenancy split is the schema's, and 0041's header states it: `component_lifecycle_observations`
 * is NOT tenant-scoped -- a part being EOL is a fact about the world, cached once and shared --
 * while boards, BOM snapshots and supply findings are, through
 * board -> repository -> installation. So the lifecycle join is unscoped by design, and every
 * other join carries the tenant WHERE. Getting that backwards either leaks a customer's BOM or
 * re-fetches the same public fact per tenant.
 */

/** Matches `ComponentLifecycleStatus` in cloud-core, plus the absence of any observation. */
export type PartLifecycle = "active" | "nrnd" | "eol" | "obsolete" | "unknown" | "unobserved";

export type PartInventoryEntry = {
  /**
   * Normalized identity, from cloud-core's `componentKey`, so a row on this page and the part the
   * supply-watch pass reasoned about are the same thing by construction. Its JSON-pair encoding
   * also means no separator a manufacturer name might contain can collapse two parts into one.
   */
  key: string;
  mpn: string;
  manufacturer: string | undefined;
  /** How many of the viewer's boards currently list this part. */
  boardCount: number;
  /** Up to three board names, for recognising the part without opening anything. */
  boardNames: readonly string[];
  totalQuantity: number;
  lifecycle: PartLifecycle;
  lifecycleObservedAt: string | undefined;
  lifecycleSource: string | undefined;
  openFindingCount: number;
  /** The most severe open supply finding on this part, across the viewer's boards. */
  worstSeverity: "critical" | "high" | "medium" | undefined;
};

export type PartsInventoryResult =
  | { state: "signed-out" }
  | { state: "not-configured" }
  | {
      state: "ok";
      parts: readonly PartInventoryEntry[];
      /**
       * BOM rows on the current snapshots with no manufacturer part number. They cannot be
       * matched against anything, so they are absent from `parts` -- reported rather than
       * silently dropped, because a board that is mostly unidentified parts looks reassuringly
       * clean otherwise.
       */
      unidentifiedComponentCount: number;
    };

export type PartsInventoryFilters = {
  /** Free text over MPN and manufacturer. */
  query?: string | undefined;
  lifecycle?: PartLifecycle | undefined;
  /** `at-risk` keeps only parts with an open supply finding or a risky lifecycle. */
  risk?: "at-risk" | undefined;
  limit?: number | undefined;
};

const defaultPageSize = 100;
const maxPageSize = 500;

const lifecycleValues = new Set<PartLifecycle>(["active", "nrnd", "eol", "obsolete", "unknown", "unobserved"]);

/** Parses an untrusted `?lifecycle=` value, so a hand-edited URL cannot reach the query. */
export function parsePartLifecycle(value: string | undefined): PartLifecycle | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase() as PartLifecycle;
  return lifecycleValues.has(normalized) ? normalized : undefined;
}

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function count(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number(value);
  return 0;
}

function severityOf(rank: number): "critical" | "high" | "medium" | undefined {
  if (rank >= 3) return "critical";
  if (rank === 2) return "high";
  if (rank === 1) return "medium";
  return undefined;
}

function lifecycleOf(status: string | undefined): PartLifecycle {
  if (!status) return "unobserved";
  const normalized = status.trim().toLowerCase();
  return lifecycleValues.has(normalized as PartLifecycle) ? (normalized as PartLifecycle) : "unknown";
}

function boardNamesOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

/**
 * `$1` installation ids, `$2` free-text (or null), `$3` lifecycle (or null), `$4` at-risk flag,
 * `$5` limit.
 *
 * `distinct on (board_id)` picks each board's newest snapshot; the ordering inside it has to
 * match the distinct key or Postgres rejects it, hence `board_id` first and `captured_at desc`
 * second. `dnp` rows are excluded: a do-not-populate part is on the drawing, not on the board,
 * so an EOL warning about one is noise.
 */
const partsInventoryQuery = `
  with visible_boards as (
    select boards.id, boards.display_name
      from boards
      join repositories on repositories.id = boards.repository_id
      join installations on installations.id = repositories.installation_id
     where installations.github_installation_id = any($1::bigint[])
       and repositories.disabled_at is null
       and installations.suspended_at is null
       and boards.archived_at is null
       and ${notCancelledSubscription}
  ),
  latest_snapshot as (
    select distinct on (snapshot.board_id)
           snapshot.id,
           snapshot.board_id
      from board_bom_snapshots as snapshot
      join visible_boards on visible_boards.id = snapshot.board_id
     order by snapshot.board_id, snapshot.captured_at desc, snapshot.id desc
  ),
  current_components as (
    select component.mpn,
           component.manufacturer,
           component.quantity,
           latest_snapshot.board_id,
           visible_boards.display_name
      from board_bom_components as component
      join latest_snapshot on latest_snapshot.id = component.snapshot_id
      join visible_boards on visible_boards.id = latest_snapshot.board_id
     where component.dnp = false
  ),
  parts as (
    select lower(mpn) as mpn_key,
           lower(coalesce(manufacturer, '')) as manufacturer_key,
           min(mpn) as mpn,
           min(manufacturer) as manufacturer,
           count(distinct board_id)::int as board_count,
           sum(coalesce(quantity, 1))::int as total_quantity,
           (array_agg(distinct display_name order by display_name))[1:3] as board_names
      from current_components
     where mpn is not null
     group by 1, 2
  )
  select parts.mpn_key,
         parts.manufacturer_key,
         parts.mpn,
         parts.manufacturer,
         parts.board_count,
         parts.total_quantity,
         parts.board_names,
         observation.status as lifecycle_status,
         observation.observed_at as lifecycle_observed_at,
         observation.source as lifecycle_source,
         open_findings.finding_count,
         open_findings.severity_rank
    from parts
    left join component_lifecycle_observations as observation
      on lower(observation.mpn) = parts.mpn_key
     and lower(coalesce(observation.manufacturer, '')) = parts.manufacturer_key
    left join lateral (
      select count(*)::int as finding_count,
             coalesce(max(case lower(finding.severity)
                            when 'critical' then 3
                            when 'high' then 2
                            when 'medium' then 1
                            else 0
                          end), 0)::int as severity_rank
        from board_supply_findings as finding
        join visible_boards on visible_boards.id = finding.board_id
       where lower(finding.mpn) = parts.mpn_key
         and lower(coalesce(finding.manufacturer, '')) = parts.manufacturer_key
         and finding.resolved_at is null
    ) as open_findings on true
   where ($2::text is null or parts.mpn_key like '%' || $2 || '%' or parts.manufacturer_key like '%' || $2 || '%')
     and ($3::text is null or coalesce(lower(observation.status), 'unobserved') = $3)
     and (
       $4::boolean is false
       or coalesce(open_findings.finding_count, 0) > 0
       or lower(coalesce(observation.status, '')) in ('nrnd', 'eol', 'obsolete')
     )
   order by coalesce(open_findings.severity_rank, 0) desc,
            coalesce(open_findings.finding_count, 0) desc,
            case lower(coalesce(observation.status, ''))
              when 'obsolete' then 3
              when 'eol' then 2
              when 'nrnd' then 1
              else 0
            end desc,
            parts.board_count desc,
            parts.mpn_key
   limit $5`;

/**
 * Counts BOM rows on the same current snapshots that carry no MPN.
 *
 * Its `visible_boards` must stay identical to the listing's, exclusion clause included -- two
 * definitions of "boards this viewer can see" that drift apart would report a caveat about rows
 * the listing never considered.
 */
const unidentifiedCountQuery = `
  with visible_boards as (
    select boards.id
      from boards
      join repositories on repositories.id = boards.repository_id
      join installations on installations.id = repositories.installation_id
     where installations.github_installation_id = any($1::bigint[])
       and repositories.disabled_at is null
       and installations.suspended_at is null
       and boards.archived_at is null
       and ${notCancelledSubscription}
  ),
  latest_snapshot as (
    select distinct on (snapshot.board_id) snapshot.id, snapshot.board_id
      from board_bom_snapshots as snapshot
      join visible_boards on visible_boards.id = snapshot.board_id
     order by snapshot.board_id, snapshot.captured_at desc, snapshot.id desc
  )
  select count(*)::int as total
    from board_bom_components as component
    join latest_snapshot on latest_snapshot.id = component.snapshot_id
   where component.mpn is null
     and component.dnp = false`;

export async function loadPartsInventory(
  session: UserSession | undefined,
  filters: PartsInventoryFilters = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PartsInventoryResult> {
  if (reviewFixturesEnabled(environment)) return { state: "not-configured" };
  if (!session || session.installationIds.length === 0) return { state: "signed-out" };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const limit = Math.min(Math.max(filters.limit ?? defaultPageSize, 1), maxPageSize);
  // Lowercased here so the comparison matches the lowercased columns without a per-row function
  // call, and escaped so a `%` typed into the search box is a literal percent sign.
  const search = filters.query?.trim()
    ? filters.query
        .trim()
        .toLowerCase()
        // Backslash first, or the escapes added below would themselves be escaped.
        .replaceAll("\\", String.raw`\\`)
        .replaceAll("%", String.raw`\%`)
        .replaceAll("_", String.raw`\_`)
    : null;

  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const [partsResult, unidentifiedResult] = await Promise.all([
      executor.query(partsInventoryQuery, [
        session.installationIds,
        search,
        filters.lifecycle ?? null,
        filters.risk === "at-risk",
        limit,
      ]),
      executor.query(unidentifiedCountQuery, [session.installationIds]),
    ]);

    const rows = (partsResult as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const parts = rows.flatMap((row): PartInventoryEntry[] => {
      const mpn = text(row, "mpn");
      if (!mpn) return [];
      const manufacturer = text(row, "manufacturer");
      return [
        {
          key: componentKey({ mpn, ...(manufacturer ? { manufacturer } : {}) }),
          mpn,
          manufacturer,
          boardCount: count(row, "board_count"),
          boardNames: boardNamesOf(row.board_names),
          totalQuantity: count(row, "total_quantity"),
          lifecycle: lifecycleOf(text(row, "lifecycle_status")),
          lifecycleObservedAt: text(row, "lifecycle_observed_at"),
          lifecycleSource: text(row, "lifecycle_source"),
          openFindingCount: count(row, "finding_count"),
          worstSeverity: severityOf(count(row, "severity_rank")),
        },
      ];
    });

    const unidentifiedRows = (unidentifiedResult as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    return {
      state: "ok",
      parts,
      unidentifiedComponentCount: count(unidentifiedRows[0] ?? {}, "total"),
    };
  } finally {
    await executor.close();
  }
}
