// The evaluator looks these observations up by componentKey, so the store must key them
// with the same function. Two spellings of "the same part" silently miss every cache hit.
import {
  type ComponentAlternate,
  type ComponentDataTrust,
  type ComponentDistributorClassification,
  componentKey,
  type PriceBreak,
} from "@boardreadyops/cloud-core";
import type { ObservationCacheScope } from "@boardreadyops/cloud-core/supply-watch";
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
  availableUnits?: number | undefined;
  leadTimeDays?: number | undefined;
  supplierCount?: number | undefined;
  alternates?: readonly ComponentAlternate[] | undefined;
  restrictedSubstances?: boolean | undefined;
  complianceNotes?: readonly string[] | undefined;
  trust?: ComponentDataTrust | undefined;
};

export type SupplyFindingInput = {
  boardId: string;
  mpn: string;
  manufacturer?: string | undefined;
  reference?: string | undefined;
  status: "nrnd" | "eol" | "obsolete" | "unavailable" | "restricted";
  severity: "critical" | "high" | "medium";
  /** Stable provider identifier captured when the finding first opens. */
  source: string;
  restrictedSubstances?: boolean | undefined;
  complianceNotes?: readonly string[] | undefined;
  trust?: ComponentDataTrust | undefined;
};

export type WatchOutcome = "evaluated" | "skipped_no_snapshot" | "no_provider" | "not_entitled" | "failed";

export type BoardSupplyWatchStore = {
  /** Boards whose watch is due, newest BOM snapshot attached, bounded per call. */
  claimDueBoards(now: Date, limit: number): Promise<DueBoard[]>;
  /** Cached observations for the supplied part keys that have not expired. */
  freshObservations(
    scope: ObservationCacheScope,
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
        availableUnits?: number | undefined;
        leadTimeDays?: number | undefined;
        supplierCount?: number | undefined;
        alternates?: readonly ComponentAlternate[] | undefined;
        restrictedSubstances?: boolean | undefined;
        complianceNotes?: readonly string[] | undefined;
        trust?: ComponentDataTrust | undefined;
      }
    >
  >;
  recordObservations(scope: ObservationCacheScope, observations: readonly ObservationInput[]): Promise<number>;
  /** Opens findings that are newly risky and resolves ones no longer risky. */
  reconcileFindings(
    boardId: string,
    open: readonly SupplyFindingInput[],
    now: Date,
  ): Promise<{
    opened: number;
    resolved: number;
  }>;
  suppressedPartKeys(boardId: string, now: Date): Promise<ReadonlySet<string>>;
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

function optionalInteger(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalBoolean(row: Record<string, unknown>, key: string): boolean | undefined {
  const value = row[key];
  return typeof value === "boolean" ? value : undefined;
}

function dataTrust(row: Record<string, unknown>, key: string): ComponentDataTrust | undefined {
  const value = row[key];
  return value === "verified" || value === "estimated" || value === "unverified" || value === "unknown"
    ? value
    : undefined;
}

const maximumComplianceNotes = 8;
const maximumComplianceNoteLength = 200;

function normalizeComplianceNotes(value: readonly string[] | undefined): readonly string[] | undefined {
  if (!value) return undefined;
  const notes = value
    .slice(0, maximumComplianceNotes)
    .map((note) => note.trim().slice(0, maximumComplianceNoteLength))
    .filter(Boolean);
  return notes.length > 0 ? notes : undefined;
}

function complianceNotes(row: Record<string, unknown>, key: string): readonly string[] | undefined {
  const raw = row[key];
  let parsed: unknown;
  if (Array.isArray(raw)) parsed = raw;
  else if (typeof raw === "string") parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return undefined;
  return normalizeComplianceNotes(parsed.filter((value): value is string => typeof value === "string"));
}

/** node-postgres decodes `jsonb` to a native array; a mocked executor may hand back a JSON string instead. */
function priceBreaks(row: Record<string, unknown>, key: string): readonly PriceBreak[] | undefined {
  const raw = row[key];
  let parsed: unknown;
  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (typeof raw === "string") {
    parsed = JSON.parse(raw);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return (parsed as Record<string, unknown>[]).flatMap((entry): PriceBreak[] => {
    const quantity = Number(entry.quantity);
    const price = Number(entry.price);
    const currency = entry.currency;
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || typeof currency !== "string" || !currency) return [];
    return [{ quantity, price, currency }];
  });
}

function alternates(row: Record<string, unknown>, key: string): readonly ComponentAlternate[] | undefined {
  const raw = row[key];
  let parsed: unknown;
  if (Array.isArray(raw)) parsed = raw;
  else if (typeof raw === "string") parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;

  const seen = new Set<string>();
  const values: ComponentAlternate[] = [];
  for (const entry of parsed.slice(0, 8)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const mpn = typeof record.mpn === "string" ? record.mpn.trim() : "";
    const manufacturer = typeof record.manufacturer === "string" ? record.manufacturer.trim() : undefined;
    if (!mpn || mpn.length > 128 || (manufacturer !== undefined && manufacturer.length > 128)) continue;
    const alternate: ComponentAlternate = { mpn, ...(manufacturer ? { manufacturer } : {}) };
    const identity = JSON.stringify([mpn.toLowerCase(), (manufacturer ?? "").toLowerCase()]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    values.push(alternate);
  }
  return values.length > 0 ? values : undefined;
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
        let parsed: Record<string, unknown>[] = [];
        if (Array.isArray(raw)) parsed = raw as Record<string, unknown>[];
        else if (typeof raw === "string") parsed = JSON.parse(raw) as Record<string, unknown>[];
        return {
          boardId: required(row, "board_id"),
          projectPath: required(row, "project_path"),
          displayName: required(row, "display_name"),
          installationId: required(row, "installation_id"),
          planTier: text(row, "plan_tier"),
          snapshotId: text(row, "snapshot_id"),
          components: parsed.map((component) => ({
            mpn: typeof component.mpn === "string" ? component.mpn : "",
            manufacturer: typeof component.manufacturer === "string" ? component.manufacturer : undefined,
            reference: typeof component.reference === "string" ? component.reference : "",
          })),
        };
      });
    },

    async freshObservations(scope, now, keys) {
      if (keys.length === 0) return new Map();
      const mpns = [...new Set(keys.map((key) => key.mpn.trim().toLowerCase()))];
      const result =
        scope.kind === "shared"
          ? await executor.query(
              `select mpn, manufacturer, status, source, observed_at, distributor_classification, price_breaks,
                      available_units, lead_time_days, supplier_count, alternates,
                      restricted_substances, compliance_notes, data_trust
                 from component_lifecycle_observations
                where lower(mpn) = any($1::text[])
                  and provider = $3
                  and (expires_at is null or expires_at > $2::timestamptz)`,
              [mpns, now.toISOString(), scope.providerName],
            )
          : await executor.query(
              `select mpn, manufacturer, status, source, observed_at, distributor_classification, price_breaks,
                      available_units, lead_time_days, supplier_count, alternates,
                      restricted_substances, compliance_notes, data_trust
                 from installation_component_observations
                where installation_id = $1
                  and provider = $2
                  and lower(mpn) = any($3::text[])
                  and (expires_at is null or expires_at > $4::timestamptz)`,
              [scope.installationId, scope.providerName, mpns, now.toISOString()],
            );

      const fresh = new Map<
        string,
        {
          status: string;
          source: string;
          observedAt: string;
          distributorClassification?: ComponentDistributorClassification | undefined;
          priceBreaks?: readonly PriceBreak[] | undefined;
          availableUnits?: number | undefined;
          leadTimeDays?: number | undefined;
          supplierCount?: number | undefined;
          alternates?: readonly ComponentAlternate[] | undefined;
          restrictedSubstances?: boolean | undefined;
          complianceNotes?: readonly string[] | undefined;
          trust?: ComponentDataTrust | undefined;
        }
      >();
      for (const row of rows(result)) {
        const key = componentKey({ mpn: required(row, "mpn"), manufacturer: text(row, "manufacturer") });
        const classification = distributorClassification(row, "distributor_classification");
        const breaks = priceBreaks(row, "price_breaks");
        const availableUnits = optionalInteger(row, "available_units");
        const leadTimeDays = optionalInteger(row, "lead_time_days");
        const supplierCount = optionalInteger(row, "supplier_count");
        const alternateParts = alternates(row, "alternates");
        const restrictedSubstances = optionalBoolean(row, "restricted_substances");
        const notes = complianceNotes(row, "compliance_notes");
        const trust = dataTrust(row, "data_trust");
        fresh.set(key, {
          status: required(row, "status"),
          source: required(row, "source"),
          observedAt: timestampText(row, "observed_at"),
          ...(classification === undefined ? {} : { distributorClassification: classification }),
          ...(breaks === undefined ? {} : { priceBreaks: breaks }),
          ...(availableUnits === undefined ? {} : { availableUnits }),
          ...(leadTimeDays === undefined ? {} : { leadTimeDays }),
          ...(supplierCount === undefined ? {} : { supplierCount }),
          ...(alternateParts === undefined ? {} : { alternates: alternateParts }),
          ...(restrictedSubstances === undefined ? {} : { restrictedSubstances }),
          ...(notes === undefined ? {} : { complianceNotes: notes }),
          ...(trust === undefined ? {} : { trust }),
        });
      }
      return fresh;
    },

    async recordObservations(scope, observations) {
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
          available_units: observation.availableUnits ?? null,
          lead_time_days: observation.leadTimeDays ?? null,
          supplier_count: observation.supplierCount ?? null,
          alternates: observation.alternates ?? [],
          restricted_substances: observation.restrictedSubstances ?? null,
          compliance_notes: normalizeComplianceNotes(observation.complianceNotes) ?? [],
          data_trust: observation.trust ?? null,
        })),
      );

      const result =
        scope.kind === "shared"
          ? await executor.query(
              `insert into component_lifecycle_observations (
                 provider, mpn, manufacturer, status, source, evidence_url, observed_at, expires_at,
                 distributor_classification, price_breaks, available_units, lead_time_days, supplier_count, alternates,
                 restricted_substances, compliance_notes, data_trust
               )
               select $2, entry.mpn, entry.manufacturer, entry.status, entry.source,
                      entry.evidence_url, entry.observed_at, entry.expires_at,
                      entry.distributor_classification, entry.price_breaks,
                      entry.available_units, entry.lead_time_days, entry.supplier_count, entry.alternates,
                      entry.restricted_substances, entry.compliance_notes, entry.data_trust
               from jsonb_to_recordset($1::jsonb) as entry(
                 mpn text, manufacturer text, status text, source text,
                 evidence_url text, observed_at timestamptz, expires_at timestamptz,
                 distributor_classification text, price_breaks jsonb,
                 available_units integer, lead_time_days integer, supplier_count integer, alternates jsonb,
                 restricted_substances boolean, compliance_notes jsonb, data_trust text
               )
               on conflict (lower(mpn), lower(coalesce(manufacturer, ''))) do update
                 set provider = excluded.provider,
                     status = excluded.status,
                     source = excluded.source,
                     evidence_url = excluded.evidence_url,
                     observed_at = excluded.observed_at,
                     expires_at = excluded.expires_at,
                     distributor_classification = excluded.distributor_classification,
                     price_breaks = excluded.price_breaks,
                     available_units = excluded.available_units,
                     lead_time_days = excluded.lead_time_days,
                     supplier_count = excluded.supplier_count,
                     alternates = excluded.alternates,
                     restricted_substances = excluded.restricted_substances,
                     compliance_notes = excluded.compliance_notes,
                     data_trust = excluded.data_trust
               where excluded.observed_at >= component_lifecycle_observations.observed_at
               returning id`,
              [payload, scope.providerName],
            )
          : await executor.query(
              `insert into installation_component_observations (
                 installation_id, provider, mpn, manufacturer, status, source, evidence_url, observed_at, expires_at,
                 distributor_classification, price_breaks, available_units, lead_time_days, supplier_count, alternates,
                 restricted_substances, compliance_notes, data_trust
               )
               select $1, $2, entry.mpn, entry.manufacturer, entry.status, entry.source,
                      entry.evidence_url, entry.observed_at, entry.expires_at,
                      entry.distributor_classification, entry.price_breaks,
                      entry.available_units, entry.lead_time_days, entry.supplier_count, entry.alternates,
                      entry.restricted_substances, entry.compliance_notes, entry.data_trust
               from jsonb_to_recordset($3::jsonb) as entry(
                 mpn text, manufacturer text, status text, source text,
                 evidence_url text, observed_at timestamptz, expires_at timestamptz,
                 distributor_classification text, price_breaks jsonb,
                 available_units integer, lead_time_days integer, supplier_count integer, alternates jsonb,
                 restricted_substances boolean, compliance_notes jsonb, data_trust text
               )
               on conflict (installation_id, provider, lower(mpn), lower(coalesce(manufacturer, ''))) do update
                 set status = excluded.status,
                     source = excluded.source,
                     evidence_url = excluded.evidence_url,
                     observed_at = excluded.observed_at,
                     expires_at = excluded.expires_at,
                     distributor_classification = excluded.distributor_classification,
                     price_breaks = excluded.price_breaks,
                     available_units = excluded.available_units,
                     lead_time_days = excluded.lead_time_days,
                     supplier_count = excluded.supplier_count,
                     alternates = excluded.alternates,
                     restricted_substances = excluded.restricted_substances,
                     compliance_notes = excluded.compliance_notes,
                     data_trust = excluded.data_trust
                 where excluded.observed_at >= installation_component_observations.observed_at
               returning id`,
              [scope.installationId, scope.providerName, payload],
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
          source: finding.source,
          restricted_substances: finding.restrictedSubstances ?? null,
          compliance_notes: normalizeComplianceNotes(finding.complianceNotes) ?? [],
          observation_trust: finding.trust ?? null,
        })),
      );
      const result = await executor.query(
        `with incoming as (
           select entry.mpn, entry.manufacturer, entry.reference, entry.status, entry.severity, entry.source,
                  entry.restricted_substances, entry.compliance_notes, entry.observation_trust
           from jsonb_to_recordset($2::jsonb) as entry(
             mpn text, manufacturer text, reference text, status text, severity text, source text,
             restricted_substances boolean, compliance_notes jsonb, observation_trust text
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
           insert into board_supply_findings (
             board_id, mpn, manufacturer, reference, status, severity, observation_source,
             restricted_substances, compliance_notes, observation_trust, detected_at
           )
           select $1, incoming.mpn, incoming.manufacturer, incoming.reference,
                  incoming.status, incoming.severity, incoming.source,
                  incoming.restricted_substances, incoming.compliance_notes, incoming.observation_trust,
                  $3::timestamptz
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

    async suppressedPartKeys(boardId, now) {
      const result = await executor.query(
        `select finding.mpn, finding.manufacturer
           from board_supply_findings as finding
          where finding.board_id = $1
            and finding.resolved_at is null
            and exists (
              select 1
                from supply_finding_suppressions as suppression
               where suppression.finding_id = finding.id
                 and suppression.cleared_at is null
                 and suppression.expires_at > $2::timestamptz
            )`,
        [boardId, now.toISOString()],
      );

      return new Set(
        rows(result).flatMap((row) => {
          const mpn = text(row, "mpn");
          if (!mpn) return [];
          const manufacturer = text(row, "manufacturer");
          return [componentKey({ mpn, ...(manufacturer ? { manufacturer } : {}) })];
        }),
      );
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
