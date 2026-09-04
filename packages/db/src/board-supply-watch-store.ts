// The evaluator looks these observations up by componentKey, so the store must key them
// with the same function. Two spellings of "the same part" silently miss every cache hit.
import { type ComponentDistributorClassification, componentKey, type PriceBreak } from "@boardreadyops/cloud-core";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type DueBoard = {
  boardId: string;
  projectPath: string;
  displayName: string;
  installationId: string;
  snapshotId: string | undefined;
  components: readonly { mpn: string; manufacturer: string | undefined; reference: string }[];
  /** Stored plan tier of the owning installation; the pass decides what it permits. */
  planTier: string | null | undefined;
};

export type ObservationInput = {
  mpn: string;
  manufacturer?: string | undefined;
  status: "active" | "nrnd" | "eol" | "obsolete" | "unknown";
  source: string;
  evidenceUrl?: string | undefined;
  observedAt: Date;
  expiresAt?: Date | undefined;
  distributorClassification?: ComponentDistributorClassification | undefined;
  priceBreaks?: readonly PriceBreak[] | undefined;
};

export type SupplyFindingInput = {
  boardId: string;
  mpn: string;
  manufacturer?: string | undefined;
  reference?: string | undefined;
  status: "nrnd" | "eol" | "obsolete";
  severity: "critical" | "high" | "medium";
};

export type WatchOutcome = "evaluated" | "skipped_no_snapshot" | "no_provider" | "not_entitled" | "failed";

export type BoardSupplyWatchStore = {
  /** Boards whose watch is due, newest BOM snapshot attached, bounded per call. */
  claimDueBoards(now: Date, limit: number): Promise<DueBoard[]>;
  /** Cached observations for the supplied part keys that have not expired. */
  freshObservations(
    now: Date,
    keys: readonly { mpn: string; manufacturer?: string | undefined }[],
  ): Promise<
    Map<
      string,
      {
        status: string;
        source: string;
        observedAt: string;
        distributorClassification?: ComponentDistributorClassification | undefined;
        priceBreaks?: readonly PriceBreak[] | undefined;
      }
    >
  >;
  recordObservations(observations: readonly ObservationInput[]): Promise<number>;
  /** Opens findings that are newly risky and resolves ones no longer risky. */
  reconcileFindings(
    boardId: string,
    open: readonly SupplyFindingInput[],
    now: Date,
  ): Promise<{
    opened: number;
    resolved: number;
  }>;
  completeEvaluation(boardId: string, outcome: WatchOutcome, now: Date, nextDueAt: Date): Promise<void>;
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
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

/**
 * Reads a timestamp column as an ISO string.
 *
 * node-postgres decodes `timestamptz` to a JS Date, so treating these columns as plain
 * strings throws on a perfectly valid row.
 */
function timestampText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new Error(`expected timestamp column ${key}`);
}

function distributorClassification(
  row: Record<string, unknown>,
  key: string,
): ComponentDistributorClassification | undefined {
  const value = row[key];
  return value === "authorized-distributor" || value === "marketplace" || value === "unknown" ? value : undefined;
}

/** node-postgres decodes `jsonb` to a native array; a mocked executor may hand back a JSON string instead. */
function priceBreaks(row: Record<string, unknown>, key: string): readonly PriceBreak[] | undefined {
  const raw = row[key];
  const parsed = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : undefined;
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return (parsed as Record<string, unknown>[]).flatMap((entry): PriceBreak[] => {
    const quantity = Number(entry.quantity);
    const price = Number(entry.price);
    const currency = entry.currency;
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || typeof currency !== "string" || !currency) return [];
    return [{ quantity, price, currency }];
  });
}

export function createSqlBoardSupplyWatchStore(executor: SqlQueryExecutor): BoardSupplyWatchStore {
  return {
    async claimDueBoards(now, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
        throw new Error("limit must be between 1 and 500");
      }
      const result = await executor.query(
        `with due as (
           select watch.board_id
           from board_supply_watch as watch
           where watch.enabled and watch.next_due_at <= $1::timestamptz
           order by watch.next_due_at
           limit $2
           for update of watch skip locked
         ),
         newest as (
           select distinct on (snapshot.board_id)
                  snapshot.board_id, snapshot.id as snapshot_id
           from board_bom_snapshots as snapshot
           join due on due.board_id = snapshot.board_id
           order by snapshot.board_id, snapshot.captured_at desc, snapshot.id desc
         )
         select boards.id as board_id,
                boards.project_path,
                boards.display_name,
                repositories.installation_id,
                installations.plan_tier,
                newest.snapshot_id,
                coalesce(
                  (select jsonb_agg(jsonb_build_object(
                     'mpn', component.mpn,
                     'manufacturer', component.manufacturer,
                     'reference', component.reference
                   ))
                   from board_bom_components as component
                   where component.snapshot_id = newest.snapshot_id and component.mpn is not null),
                  '[]'::jsonb
                ) as components
         from due
         join boards on boards.id = due.board_id
         join repositories on repositories.id = boards.repository_id
         join installations on installations.id = repositories.installation_id
         left join newest on newest.board_id = due.board_id
         order by boards.project_path`,
        [now.toISOString(), limit],
      );

      return rows(result).map((row): DueBoard => {
        const raw = row.components;
        const parsed = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : [];
        return {
          boardId: required(row, "board_id"),
          projectPath: required(row, "project_path"),
          displayName: required(row, "display_name"),
          installationId: required(row, "installation_id"),
          planTier: text(row, "plan_tier"),
          snapshotId: text(row, "snapshot_id"),
          components: (parsed as Record<string, unknown>[]).map((component) => ({
            mpn: String(component.mpn ?? ""),
            manufacturer: typeof component.manufacturer === "string" ? component.manufacturer : undefined,
            reference: String(component.reference ?? ""),
          })),
        };
      });
    },

    async freshObservations(now, keys) {
      if (keys.length === 0) return new Map();
      const mpns = [...new Set(keys.map((key) => key.mpn.trim().toLowerCase()))];
      const result = await executor.query(
        `select mpn, manufacturer, status, source, observed_at, distributor_classification, price_breaks
         from component_lifecycle_observations
         where lower(mpn) = any($1::text[])
           and (expires_at is null or expires_at > $2::timestamptz)`,
        [mpns, now.toISOString()],
      );

      const fresh = new Map<
        string,
        {
          status: string;
          source: string;
          observedAt: string;
          distributorClassification?: ComponentDistributorClassification | undefined;
          priceBreaks?: readonly PriceBreak[] | undefined;
        }
      >();
      for (const row of rows(result)) {
        const key = componentKey({ mpn: required(row, "mpn"), manufacturer: text(row, "manufacturer") });
        fresh.set(key, {
          status: required(row, "status"),
          source: required(row, "source"),
          observedAt: timestampText(row, "observed_at"),
          distributorClassification: distributorClassification(row, "distributor_classification"),
          priceBreaks: priceBreaks(row, "price_breaks"),
        });
      }
      return fresh;
    },

    async recordObservations(observations) {
      if (observations.length === 0) return 0;
      const payload = JSON.stringify(
        observations.map((observation) => ({
          mpn: observation.mpn,
          manufacturer: observation.manufacturer ?? null,
          status: observation.status,
          source: observation.source,
          evidence_url: observation.evidenceUrl ?? null,
          observed_at: observation.observedAt.toISOString(),
          expires_at: observation.expiresAt?.toISOString() ?? null,
          distributor_classification: observation.distributorClassification ?? null,
          price_breaks: observation.priceBreaks ?? [],
        })),
      );
      const result = await executor.query(
        `insert into component_lifecycle_observations (
           mpn, manufacturer, status, source, evidence_url, observed_at, expires_at,
           distributor_classification, price_breaks
         )
         select entry.mpn, entry.manufacturer, entry.status, entry.source,
                entry.evidence_url, entry.observed_at, entry.expires_at,
                entry.distributor_classification, entry.price_breaks
         from jsonb_to_recordset($1::jsonb) as entry(
           mpn text, manufacturer text, status text, source text,
           evidence_url text, observed_at timestamptz, expires_at timestamptz,
           distributor_classification text, price_breaks jsonb
         )
         on conflict (lower(mpn), lower(coalesce(manufacturer, ''))) do update
           set status = excluded.status,
               source = excluded.source,
               evidence_url = excluded.evidence_url,
               observed_at = excluded.observed_at,
               expires_at = excluded.expires_at,
               distributor_classification = excluded.distributor_classification,
               price_breaks = excluded.price_breaks
           where excluded.observed_at >= component_lifecycle_observations.observed_at
         returning id`,
        [payload],
      );
      return rows(result).length;
    },

    async reconcileFindings(boardId, open, now) {
      const payload = JSON.stringify(
        open.map((finding) => ({
          mpn: finding.mpn,
          manufacturer: finding.manufacturer ?? null,
          reference: finding.reference ?? null,
          status: finding.status,
          severity: finding.severity,
        })),
      );
      const result = await executor.query(
        `with incoming as (
           select entry.mpn, entry.manufacturer, entry.reference, entry.status, entry.severity
           from jsonb_to_recordset($2::jsonb) as entry(
             mpn text, manufacturer text, reference text, status text, severity text
           )
         ),
         resolved as (
           update board_supply_findings as finding
           set resolved_at = $3::timestamptz
           where finding.board_id = $1
             and finding.resolved_at is null
             and not exists (
               select 1 from incoming
               where lower(incoming.mpn) = lower(finding.mpn)
                 and lower(coalesce(incoming.manufacturer, '')) = lower(coalesce(finding.manufacturer, ''))
                 and incoming.status = finding.status
             )
           returning finding.id
         ),
         opened as (
           insert into board_supply_findings (board_id, mpn, manufacturer, reference, status, severity, detected_at)
           select $1, incoming.mpn, incoming.manufacturer, incoming.reference,
                  incoming.status, incoming.severity, $3::timestamptz
           from incoming
           on conflict do nothing
           returning id
         )
         select (select count(*) from opened)::int as opened,
                (select count(*) from resolved)::int as resolved`,
        [boardId, payload, now.toISOString()],
      );
      const row = rows(result)[0] ?? {};
      return {
        opened: Number(row.opened ?? 0),
        resolved: Number(row.resolved ?? 0),
      };
    },

    async completeEvaluation(boardId, outcome, now, nextDueAt) {
      await executor.query(
        `update board_supply_watch
         set last_evaluated_at = $2::timestamptz,
             last_outcome = $3,
             next_due_at = $4::timestamptz,
             consecutive_failures = case when $3 = 'failed' then consecutive_failures + 1 else 0 end
         where board_id = $1`,
        [boardId, now.toISOString(), outcome, nextDueAt.toISOString()],
      );
    },
  };
}
