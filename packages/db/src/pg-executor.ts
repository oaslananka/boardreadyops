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
  /** Pins every statement in one logical write to a single PG client. */
  withTransaction<T>(work: (transaction: SqlQueryExecutor) => Promise<T>): Promise<T>;
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
    async withTransaction<T>(work: (transaction: SqlQueryExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const transaction: SqlQueryExecutor = {
          async query(sql, params = []) {
            return await client.query(sql, [...params]);
          },
        };
        const result = await work(transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure; the pool handles damaged clients.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
