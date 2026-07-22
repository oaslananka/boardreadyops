import { describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../../packages/db/src/control-plane-operations-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const now = new Date("2026-07-22T16:00:00.000Z");

describe("control-plane operations store", () => {
  it("lists tenant-scoped dead letters without payload-bearing columns", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_list_control_plane_dead_letters");
        expect(params).toEqual(["installation-1", 25, null]);
        expect(sql).not.toContain("normalized_actions");
        expect(sql).not.toContain("payload");
        return {
          rows: [
            {
              item_type: "outbox",
              item_id: "outbox-1",
              installation_id: "installation-1",
              repository_id: "repository-1",
              repository_full_name: "octo/board",
              release_run_id: "run-1",
              execution_attempt_id: "attempt-1",
              reason_code: "delivery_uncertain",
              error_class: "WorkflowDispatchDeliveryUncertainError",
              attempt_count: 2,
              failed_at: new Date("2026-07-22T15:55:00.000Z"),
              replay_safe: false,
            },
          ],
        };
      },
    };

    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });
    await expect(store.listDeadLetters({ installationId: "installation-1", limit: 25 })).resolves.toEqual([
      {
        itemType: "outbox",
        itemId: "outbox-1",
        installationId: "installation-1",
        repositoryId: "repository-1",
        repositoryFullName: "octo/board",
        releaseRunId: "run-1",
        executionAttemptId: "attempt-1",
        reasonCode: "delivery_uncertain",
        errorClass: "WorkflowDispatchDeliveryUncertainError",
        attemptCount: 2,
        failedAt: "2026-07-22T15:55:00.000Z",
        replaySafe: false,
      },
    ]);
  });

  it("replays a tenant-scoped dead letter with an idempotent operation id", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_replay_control_plane_dead_letter");
        expect(params).toEqual([
          "installation-1",
          "job",
          "job-1",
          "operation-1",
          "operator-1",
          "2026-07-22T16:00:00.000Z",
        ]);
        return { rows: [{ outcome: "replayed", audit_event_id: "audit-1" }] };
      },
    };

    await expect(
      createSqlControlPlaneOperationsStore(executor, { now: () => now }).replayDeadLetter({
        installationId: "installation-1",
        itemType: "job",
        itemId: "job-1",
        operationId: "operation-1",
        actorId: "operator-1",
      }),
    ).resolves.toEqual({ outcome: "replayed", auditEventId: "audit-1" });
  });

  it("claims and decodes durable reconciliation items", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_claim_control_plane_reconciliation");
        expect(params).toEqual(["worker-1", "2026-07-22T16:00:00.000Z", "2026-07-22T16:02:00.000Z", 4]);
        return {
          rows: [
            {
              reconciliation_id: "reconciliation-1",
              installation_id: "installation-1",
              repository_id: "repository-1",
              release_run_id: "run-1",
              execution_attempt_id: "attempt-1",
              subject_type: "execution_attempt",
              subject_id: "attempt-1",
              reason_code: "callback_missing",
              deadline_at: new Date("2026-07-22T16:05:00.000Z"),
              next_check_at: new Date("2026-07-22T16:00:00.000Z"),
              attempt_count: 1,
            },
          ],
        };
      },
    };

    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now, leaseSeconds: 120 });
    await expect(store.claimReconciliationItems({ workerId: "worker-1", limit: 4 })).resolves.toEqual([
      {
        reconciliationId: "reconciliation-1",
        installationId: "installation-1",
        repositoryId: "repository-1",
        releaseRunId: "run-1",
        executionAttemptId: "attempt-1",
        subjectType: "execution_attempt",
        subjectId: "attempt-1",
        reasonCode: "callback_missing",
        deadlineAt: "2026-07-22T16:05:00.000Z",
        nextCheckAt: "2026-07-22T16:00:00.000Z",
        attemptCount: 1,
      },
    ]);
  });

  it("decodes privacy-safe service indicators from PostgreSQL numeric values", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_control_plane_sli_snapshot");
        expect(params).toEqual([null, "2026-07-22T16:00:00.000Z"]);
        return {
          rows: [
            {
              webhook_acceptance_p95_ms: "120",
              lifecycle_queue_age_seconds: "8",
              outbox_lag_seconds: 4,
              dispatch_latency_p95_seconds: 12,
              completion_latency_p95_seconds: 180,
              stale_attempts: 2,
              reconciliation_backlog: 3,
              reconciliation_repairs_24h: 7,
              terminal_failures_24h: 1,
              terminal_runs_24h: "40",
              terminal_failure_rate_basis_points: "250",
            },
          ],
        };
      },
    };

    await expect(
      createSqlControlPlaneOperationsStore(executor, { now: () => now }).collectSliSnapshot(),
    ).resolves.toEqual({
      webhookAcceptanceP95Ms: 120,
      lifecycleQueueAgeSeconds: 8,
      outboxLagSeconds: 4,
      dispatchLatencyP95Seconds: 12,
      completionLatencyP95Seconds: 180,
      staleAttempts: 2,
      reconciliationBacklog: 3,
      reconciliationRepairs24h: 7,
      terminalFailures24h: 1,
      terminalRuns24h: 40,
      terminalFailureRateBasisPoints: 250,
    });
  });

  it("redacts credentials from persisted reconciliation failures", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_fail_control_plane_reconciliation");
        expect(String(params?.[5])).not.toContain("authorization=");
        expect(String(params?.[5])).toContain("[REDACTED]");
        return { rows: [{ outcome: "retry" }] };
      },
    };

    await expect(
      createSqlControlPlaneOperationsStore(executor, { now: () => now }).failReconciliationItem({
        reconciliationId: "reconciliation-1",
        workerId: "worker-1",
        attemptCount: 1,
        errorClass: "NetworkError",
        errorMessage: `authorization=Bearer ${"x".repeat(200)}`,
      }),
    ).resolves.toBe("retry");
  });

  it("rejects malformed tenant, worker, and operation identifiers", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        throw new Error("unexpected query");
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor);

    await expect(store.listDeadLetters({ installationId: " contains space " })).rejects.toThrow(
      "invalid installation id",
    );
    await expect(
      store.replayDeadLetter({
        installationId: "installation-1",
        itemType: "job",
        itemId: "job-1",
        operationId: "bad operation",
        actorId: "operator-1",
      }),
    ).rejects.toThrow("invalid operation id");
    await expect(store.claimReconciliationItems({ workerId: "bad worker" })).rejects.toThrow(
      "invalid reconciliation worker id",
    );
  });
});
