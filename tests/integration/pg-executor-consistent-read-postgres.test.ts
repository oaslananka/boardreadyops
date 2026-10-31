import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const owner = connectionString ? createPgQueryExecutor({ connectionString, max: 1 }) : undefined;
const writer = connectionString ? createPgQueryExecutor({ connectionString, max: 1 }) : undefined;
const table = `pg_executor_consistent_read_${randomUUID().replaceAll("-", "")}`;

function rows(result: unknown): Array<Record<string, unknown>> {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const values = (result as { rows?: unknown }).rows;
  return Array.isArray(values) ? values : [];
}

function db() {
  if (!owner) throw new Error("Disposable test database required");
  return owner;
}
function concurrentDb() {
  if (!writer) throw new Error("Second disposable database connection required");
  return writer;
}

beforeAll(async () => {
  if (!owner) return;
  await db().query(`CREATE TABLE ${table} (id text primary key, item_value integer not null)`);
});

afterAll(async () => {
  if (!owner) return;
  try {
    await db().query(`DROP TABLE IF EXISTS ${table}`);
  } finally {
    await Promise.all([owner.close(), writer?.close()]);
  }
});

describeDatabase("PgQueryExecutor consistent read option", () => {
  it("preserves the existing writable read-committed transaction default", async () => {
    const id = randomUUID();
    await db().withTransaction(async (transaction) => {
      const settings = await transaction.query("SHOW transaction_isolation");
      expect(rows(settings)[0]?.transaction_isolation).toBe("read committed");
      await transaction.query(`INSERT INTO ${table} (id, item_value) VALUES ($1, $2)`, [id, 1]);
    });
    const saved = await db().query(`SELECT item_value FROM ${table} WHERE id=$1`, [id]);
    expect(rows(saved)[0]?.item_value).toBe(1);
  });

  it("keeps a repeatable-read snapshot while another connection changes a row", async () => {
    const id = randomUUID();
    await db().query(`INSERT INTO ${table} (id, item_value) VALUES ($1, 1)`, [id]);

    await db().withTransaction(
      async (transaction) => {
        const isolation = await transaction.query("SHOW transaction_isolation");
        const readOnly = await transaction.query("SHOW transaction_read_only");
        const timeout = await transaction.query("SHOW statement_timeout");
        expect(rows(isolation)[0]?.transaction_isolation).toBe("repeatable read");
        expect(rows(readOnly)[0]?.transaction_read_only).toBe("on");
        expect(rows(timeout)[0]?.statement_timeout).toBe("5s");

        const before = await transaction.query(`SELECT item_value FROM ${table} WHERE id=$1`, [id]);
        expect(rows(before)[0]?.item_value).toBe(1);
        await concurrentDb().query(`UPDATE ${table} SET item_value=2 WHERE id=$1`, [id]);
        const after = await transaction.query(`SELECT item_value FROM ${table} WHERE id=$1`, [id]);
        expect(rows(after)[0]?.item_value).toBe(1);
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );

    const fresh = await db().query(`SELECT item_value FROM ${table} WHERE id=$1`, [id]);
    expect(rows(fresh)[0]?.item_value).toBe(2);
  });

  it("rejects writes inside a consistent-read transaction and safely rolls back", async () => {
    const id = randomUUID();
    await expect(
      db().withTransaction(
        async (transaction) => {
          await transaction.query(`INSERT INTO ${table} (id, item_value) VALUES ($1, 1)`, [id]);
        },
        { consistentRead: true },
      ),
    ).rejects.toThrow();
    const absent = await db().query(`SELECT id FROM ${table} WHERE id=$1`, [id]);
    expect(rows(absent)).toHaveLength(0);

    const recovered = await db().query("SELECT 1 AS healthy");
    expect(rows(recovered)[0]?.healthy).toBe(1);
  });

  it("rejects an invalid timeout without keeping the connection in a transaction", async () => {
    await expect(
      db().withTransaction(async () => undefined, { consistentRead: true, statementTimeoutMs: 0 }),
    ).rejects.toThrow("Invalid transaction statement timeout");
    const result = await db().query("SHOW transaction_read_only");
    expect(rows(result)[0]?.transaction_read_only).toBe("off");
  });
});
