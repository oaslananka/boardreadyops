import type { ProductionBatchInput } from "@boardreadyops/cloud-core/production-outcomes";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type ProductionOutcomeSourceKind = "csv" | "api" | "manual";

export type ImportProductionBatchInput = {
  installationId: string;
  releaseRunId: string;
  batch: ProductionBatchInput;
  sourceKind: ProductionOutcomeSourceKind;
  sourceSha256: string;
  sourceName?: string | undefined;
};

export type ImportedProductionBatch = {
  id: string;
  created: boolean;
};

export type ProductionOutcomeStore = {
  importBatch(input: ImportProductionBatchInput): Promise<ImportedProductionBatch>;
};

type Row = Record<string, unknown>;

const sha256Pattern = /^[0-9a-f]{64}$/u;

function resultRows(result: unknown): readonly Row[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Row[]) : [];
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new Error("Production outcome import returned an invalid " + key);
  return value;
}

function normalizedSourceName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 255) throw new Error("Production outcome source name exceeds 255 characters");
  return normalized;
}

export function createSqlProductionOutcomeStore(
  executor: SqlQueryExecutor,
  options: { now?: () => Date } = {},
): ProductionOutcomeStore {
  const now = options.now ?? (() => new Date());

  return {
    async importBatch(input) {
      if (!sha256Pattern.test(input.sourceSha256)) {
        throw new Error("Production outcome source digest must be a lowercase SHA-256 value");
      }

      const sourceName = normalizedSourceName(input.sourceName);
      const batch = input.batch;
      if (batch.defects.length > 1_000) {
        throw new Error("Production outcome batch exceeds the 1000-defect import limit");
      }

      const defects = batch.defects.map((defect) => ({
        category: defect.category,
        code: defect.code,
        count: defect.count,
        notes: defect.notes ?? null,
      }));

      const result = await executor.query(
        `with scoped_run as (
           select release_runs.id
             from release_runs
             join repositories on repositories.id = release_runs.repository_id
            where release_runs.id = $1
              and repositories.installation_id = $2
         ),
         inserted as (
           insert into production_batches (
             release_run_id,
             external_batch_id,
             manufacturer,
             manufactured_on,
             quantity,
             first_pass_yield_bps,
             rework_count,
             scrap_count,
             notes,
             corrective_action,
             source_kind,
             source_name,
             source_sha256,
             imported_at
           )
           select scoped_run.id, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz
             from scoped_run
           on conflict do nothing
           returning id
         ),
         matching as (
           select production_batches.id
             from production_batches
             join scoped_run on scoped_run.id = production_batches.release_run_id
            where lower(production_batches.manufacturer) = lower($4)
              and lower(production_batches.external_batch_id) = lower($3)
              and production_batches.manufactured_on = $5::date
              and production_batches.quantity = $6
              and production_batches.first_pass_yield_bps is not distinct from $7::integer
              and production_batches.rework_count = $8
              and production_batches.scrap_count = $9
              and production_batches.notes is not distinct from $10::text
              and production_batches.corrective_action is not distinct from $11::text
              and production_batches.source_sha256 = $14
         ),
         target as (
           select inserted.id, true as created
             from inserted
           union all
           select matching.id, false as created
             from matching
           limit 1
         ),
         defect_rows as (
           select defect.category, defect.code, defect.defect_count, defect.notes
             from jsonb_to_recordset($16::jsonb) as defect(
               category text,
               code text,
               defect_count integer,
               notes text
             )
         ),
         written_defects as (
           insert into production_batch_defects (
             production_batch_id,
             category,
             code,
             defect_count,
             notes
           )
           select target.id, defect_rows.category, defect_rows.code, defect_rows.defect_count, defect_rows.notes
             from target
             cross join defect_rows
           on conflict (production_batch_id, category, code) do nothing
           returning id
         )
         select target.id, target.created, (select count(*) from written_defects)::integer as defects_written
           from target`,
        [
          input.releaseRunId,
          input.installationId,
          batch.externalBatchId,
          batch.manufacturer,
          batch.manufacturedOn,
          batch.quantity,
          batch.firstPassYieldBps ?? null,
          batch.reworkCount,
          batch.scrapCount,
          batch.notes ?? null,
          batch.correctiveAction ?? null,
          input.sourceKind,
          sourceName ?? null,
          input.sourceSha256,
          now().toISOString(),
          JSON.stringify(defects),
        ],
      );

      const row = resultRows(result)[0];
      if (!row) {
        throw new Error(
          "Production batch conflicts with an existing batch or the release is not accessible to this installation",
        );
      }

      return { id: text(row, "id"), created: row.created === true };
    },
  };
}
