import pg from "pg";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

const { Pool } = pg;

export type PgLifecycleExecutorOptions = {
  connectionString: string;
  max?: number;
  ssl?: boolean | { rejectUnauthorized?: boolean };
};

export type PgQueryExecutor = SqlQueryExecutor & {
  close(): Promise<void>;
  /** Pinned PostgreSQL connection: DB mutations and event acknowledgement commit together. */
  withTransaction<T>(operation: (transaction: SqlQueryExecutor) => Promise<T>): Promise<T>;
};

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
    async withTransaction<T>(operation: (transaction: SqlQueryExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          // Billing projections must finish promptly; failed/crashed processes
          // release their row locks and roll back before another worker retries.
          await client.query("SET LOCAL statement_timeout = '15s'");
          const result = await operation({ query: (sql, params = []) => client.query(sql, [...params]) });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
