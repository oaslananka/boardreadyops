import pg from "pg";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

const { Pool } = pg;

export type PgLifecycleExecutorOptions = {
  connectionString: string;
  max?: number;
  ssl?: boolean | { rejectUnauthorized?: boolean };
};

export function createPgQueryExecutor(options: PgLifecycleExecutorOptions): SqlQueryExecutor {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    ssl: options.ssl,
  });

  return {
    async query(sql, params = []) {
      await pool.query(sql, [...params]);
    },
  };
}
