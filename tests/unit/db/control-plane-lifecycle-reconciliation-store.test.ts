import { describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../../packages/db/src/control-plane-operations-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const now = new Date("2026-07-24T01:30:00.000Z");

describe("control-plane lifecycle reconciliation store", () => {
  it("detects and claims tenant-scoped lifecycle reconciliation items", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (calls.length === 1) return { rows: [{ detected: "2" }] };
        return {
          rows: [
            {
              reconciliation_id: "reconciliation-1",
              installation_id: "installation-1",
              repository_id: "repository-1",
              release_run_id: null,
              execution_attempt_id: null,
              subject_type: "webhook_inbox",
              subject_id: "inbox-1",
              reason_code: "lifecycle_job_missing",
              deadline_at: new Date("2026-07-24T02:00:00.000Z"),
              next_check_at: new Date("2026-07-24T01:30:00.000Z"),
              attempt_count: 1,
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now, leaseSeconds: 120 });

    expect(typeof store.detectLifecycleReconciliationCandidates).toBe("function");
    expect(typeof store.claimLifecycleReconciliationItems).toBe("function");
    await expect(
      store.detectLifecycleReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 40,
      }),
    ).resolves.toBe(2);
    await expect(store.claimLifecycleReconciliationItems({ workerId: "worker-1", limit: 3 })).resolves.toEqual([
      {
        reconciliationId: "reconciliation-1",
        installationId: "installation-1",
        repositoryId: "repository-1",
        subjectType: "webhook_inbox",
        subjectId: "inbox-1",
        reasonCode: "lifecycle_job_missing",
        deadlineAt: "2026-07-24T02:00:00.000Z",
        nextCheckAt: "2026-07-24T01:30:00.000Z",
        attemptCount: 1,
      },
    ]);

    expect(calls[0]?.sql).toContain("boardreadyops_detect_control_plane_lifecycle_reconciliation");
    expect(calls[0]?.params).toEqual(["2026-07-24T01:30:00.000Z", 300, 1800, 40]);
    expect(calls[1]?.sql).toContain("boardreadyops_claim_control_plane_lifecycle_reconciliation");
    expect(calls[1]?.params).toEqual(["worker-1", "2026-07-24T01:30:00.000Z", "2026-07-24T01:32:00.000Z", 3]);
  });

  it.each(["applied", "already_repaired", "already_terminal"] as const)(
    "maps the %s lifecycle apply outcome",
    async (outcome) => {
      const executor: SqlQueryExecutor = {
        async query(sql, params) {
          expect(sql).toContain("boardreadyops_apply_control_plane_lifecycle_reconciliation");
          expect(params).toEqual(["reconciliation-1", "worker-1", "2026-07-24T01:30:00.000Z"]);
          return { rows: [{ outcome }] };
        },
      };
      const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });

      expect(typeof store.applyLifecycleReconciliation).toBe("function");
      await expect(
        store.applyLifecycleReconciliation({ reconciliationId: "reconciliation-1", workerId: "worker-1" }),
      ).resolves.toBe(outcome);
    },
  );

  it("maps unknown lifecycle apply outcomes to stale and validates deadlines", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        return { rows: [{ outcome: "unexpected" }] };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });

    await expect(
      store.applyLifecycleReconciliation({ reconciliationId: "reconciliation-1", workerId: "worker-1" }),
    ).resolves.toBe("stale");
    await expect(
      store.detectLifecycleReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 300,
      }),
    ).rejects.toThrow("terminalDeadlineSeconds must be greater than observationDelaySeconds");
  });
});
