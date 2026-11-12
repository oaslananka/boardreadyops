import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { acquireExclusiveWorkerOwnership } from "../../packages/db/src/worker-ownership.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase("control-plane worker exclusive PostgreSQL session ownership", () => {
  const url = connectionString ?? "";

  it("refuses a second worker until the first voluntarily stops, then permits one successor", async () => {
    const firstLost = vi.fn();
    const first = await acquireExclusiveWorkerOwnership({ connectionString: url, onLost: firstLost });
    try {
      await expect(acquireExclusiveWorkerOwnership({ connectionString: url, onLost: vi.fn() })).rejects.toThrow(
        "exclusive_worker_ownership_unavailable",
      );
      expect(firstLost).not.toHaveBeenCalled();
    } finally {
      await first.release();
    }
    const successor = await acquireExclusiveWorkerOwnership({ connectionString: url, onLost: vi.fn() });
    await successor.release();
    expect(firstLost).not.toHaveBeenCalled();
  });

  it("signals lock loss when PostgreSQL terminates the dedicated owner session", async () => {
    const lost = vi.fn();
    const owner = await acquireExclusiveWorkerOwnership({ connectionString: url, onLost: lost });
    const outsider = new pg.Client({ connectionString: url });
    try {
      await outsider.connect();
      const result = await outsider.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>pg_backend_pid()",
        ["boardreadyops-control-plane-owner"],
      );
      expect(result.rows).toHaveLength(1);
      const terminated = await outsider.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend($1) AS terminated",
        [result.rows[0]?.pid],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1), { timeout: 5_000 });
      await owner.release();
      const successor = await acquireExclusiveWorkerOwnership({ connectionString: url, onLost: vi.fn() });
      await successor.release();
    } finally {
      await outsider.end();
      await owner.release();
    }
  });
});
