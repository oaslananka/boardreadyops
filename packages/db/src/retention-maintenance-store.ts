import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RetentionMaintenanceStore = {
  purgeExpiredRunnerRequestNonces(input?: { limit?: number }): Promise<number>;
};

export type RetentionMaintenanceStoreOptions = {
  now?: () => Date;
  defaultBatchSize?: number;
};

const maximumBatchSize = 10_000;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${name} must be a positive integer`);
  return selected;
}

export function createSqlRetentionMaintenanceStore(
  executor: SqlQueryExecutor,
  options: RetentionMaintenanceStoreOptions = {},
): RetentionMaintenanceStore {
  const now = options.now ?? (() => new Date());
  const defaultBatchSize = Math.min(
    positiveInteger(options.defaultBatchSize, 1_000, "defaultBatchSize"),
    maximumBatchSize,
  );

  return {
    async purgeExpiredRunnerRequestNonces(input = {}) {
      const requestedLimit = input.limit;
      const limit =
        Number.isSafeInteger(requestedLimit) && requestedLimit !== undefined && requestedLimit > 0
          ? Math.min(requestedLimit, maximumBatchSize)
          : defaultBatchSize;
      const result = await executor.query(
        `with expired as (
           select runner_request_nonces.id
           from runner_request_nonces
           where runner_request_nonces.expires_at <= $1::timestamptz
           order by runner_request_nonces.expires_at asc, runner_request_nonces.id asc
           for update skip locked
           limit $2::integer
         ), deleted as (
           delete from runner_request_nonces
           using expired
           where runner_request_nonces.id = expired.id
           returning runner_request_nonces.id
         )
         select count(*)::int as purged from deleted`,
        [now().toISOString(), limit],
      );
      return nonNegativeInteger(rows(result)[0]?.purged);
    },
  };
}
