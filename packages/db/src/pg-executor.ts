import pg from "pg";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

const { Pool } = pg;

export type PgLifecycleExecutorOptions = {
  connectionString: string;
  max?: number;
  ssl?: boolean | { rejectUnauthorized?: boolean };
};

export type PgQueryExecutor = SqlQueryExecutor & { close(): Promise<void> };

export function createPgQueryExecutor(options: PgLifecycleExecutorOptions): PgQueryExecutor {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    ssl: options.ssl,
  });

  return {
    async query(sql, params = []) {
      return await pool.query(sql, [...params]);
    },
    async close() {
      await pool.end();
    },
  };
}
