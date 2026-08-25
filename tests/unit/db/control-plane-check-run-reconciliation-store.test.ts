import { describe, expect, it } from "vitest";
import { createSqlControlPlaneOperationsStore } from "../../../packages/db/src/control-plane-operations-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const now = new Date("2026-07-23T18:00:00.000Z");

describe("Check Run reconciliation operations store", () => {
  it("detects and claims Check Run reconciliation work", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("detect_github_check_run")) return { rows: [{ detected: "2" }] };
        return {
          rows: [
            {
              reconciliation_id: "reconciliation-check-1",
              installation_id: "installation-1",
              repository_id: "repository-1",
              release_run_id: "run-1",
              execution_attempt_id: null,
              subject_type: "release_run",
              subject_id: "run-1",
              reason_code: "reporting_stale",
              deadline_at: new Date("2026-07-23T18:30:00.000Z"),
              next_check_at: now,
              attempt_count: 1,
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now, leaseSeconds: 120 });

    await expect(
      store.detectCheckRunReconciliationCandidates({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 25,
      }),
    ).resolves.toBe(2);
    await expect(store.claimCheckRunReconciliationItems({ workerId: "worker-1", limit: 4 })).resolves.toHaveLength(1);
    expect(calls[0]?.params).toEqual(["2026-07-23T18:00:00.000Z", 300, 1800, 25]);
    expect(calls[1]?.params).toEqual(["worker-1", "2026-07-23T18:00:00.000Z", "2026-07-23T18:02:00.000Z", 4]);
  });

  it("loads content-free context and applies publication repair", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("_context")) {
          return {
            rows: [
              {
                reconciliation_id: "reconciliation-check-1",
                installation_id: "installation-1",
                github_installation_id: "123",
                repository_id: "repository-1",
                repository_owner: "octo",
                repository_name: "board",
                repository_full_name: "octo/board",
                release_run_id: "run-1",
                commit_sha: "a".repeat(40),
                github_check_run_id: "77",
                run_status: "completed",
                expected_conclusion: "success",
                result_reported: true,
                completed_at: new Date("2026-07-23T17:55:00.000Z"),
                deadline_at: new Date("2026-07-23T18:30:00.000Z"),
              },
            ],
          };
        }
        return { rows: [{ outcome: "applied" }] };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });

    await expect(
      store.loadCheckRunReconciliationContext({
        reconciliationId: "reconciliation-check-1",
        workerId: "worker-1",
      }),
    ).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      installationId: "installation-1",
      githubInstallationId: 123,
      repositoryId: "repository-1",
      repositoryOwner: "octo",
      repositoryName: "board",
      repositoryFullName: "octo/board",
      releaseRunId: "run-1",
      commitSha: "a".repeat(40),
      githubCheckRunId: 77,
      runStatus: "completed",
      expectedConclusion: "success",
      resultReported: true,
      completedAt: "2026-07-23T17:55:00.000Z",
      deadlineAt: "2026-07-23T18:30:00.000Z",
    });
    await expect(
      store.applyCheckRunReconciliation({
        reconciliationId: "reconciliation-check-1",
        workerId: "worker-1",
        observedStatus: "completed",
        observedConclusion: "success",
        action: "observed_current",
      }),
    ).resolves.toBe("applied");
    expect(calls[1]?.params).toEqual([
      "reconciliation-check-1",
      "worker-1",
      "2026-07-23T18:00:00.000Z",
      "completed",
      "success",
      "observed_current",
    ]);
  });

  it("carries through a terminal run that never reported a result", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        return {
          rows: [
            {
              reconciliation_id: "reconciliation-check-1",
              installation_id: "installation-1",
              github_installation_id: "123",
              repository_id: "repository-1",
              repository_owner: "octo",
              repository_name: "board",
              repository_full_name: "octo/board",
              release_run_id: "run-1",
              commit_sha: "a".repeat(40),
              github_check_run_id: "77",
              run_status: "failed",
              expected_conclusion: "failure",
              result_reported: false,
              completed_at: new Date("2026-07-23T17:55:00.000Z"),
              deadline_at: new Date("2026-07-23T18:30:00.000Z"),
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });

    await expect(
      store.loadCheckRunReconciliationContext({
        reconciliationId: "reconciliation-check-1",
        workerId: "worker-1",
      }),
    ).resolves.toMatchObject({ runStatus: "failed", expectedConclusion: "failure", resultReported: false });
  });

  it("assumes a result was reported when the column predates the migration", async () => {
    // A database still on schema v41 returns no result_reported column. Reading that as "no
    // result" would make the worker announce a missing result on every repair it performs.
    const executor: SqlQueryExecutor = {
      async query() {
        return {
          rows: [
            {
              reconciliation_id: "reconciliation-check-1",
              installation_id: "installation-1",
              github_installation_id: "123",
              repository_id: "repository-1",
              repository_owner: "octo",
              repository_name: "board",
              repository_full_name: "octo/board",
              release_run_id: "run-1",
              commit_sha: "a".repeat(40),
              github_check_run_id: "77",
              run_status: "completed",
              expected_conclusion: "success",
              completed_at: new Date("2026-07-23T17:55:00.000Z"),
              deadline_at: new Date("2026-07-23T18:30:00.000Z"),
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });

    await expect(
      store.loadCheckRunReconciliationContext({
        reconciliationId: "reconciliation-check-1",
        workerId: "worker-1",
      }),
    ).resolves.toMatchObject({ resultReported: true });
  });

  it("records a stable publication failure without raw GitHub content", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_fail_github_check_run_reconciliation");
        expect(params).toEqual([
          "reconciliation-check-1",
          "worker-1",
          "2026-07-23T18:00:00.000Z",
          "lookup_failed",
          null,
          "github_check_run_lookup_failed",
        ]);
        return { rows: [{ outcome: "failed" }] };
      },
    };
    const store = createSqlControlPlaneOperationsStore(executor, { now: () => now });
    await expect(
      store.finalizeCheckRunReconciliationFailure({
        reconciliationId: "reconciliation-check-1",
        workerId: "worker-1",
        observedStatus: "lookup_failed",
        publicFailureReason: "github_check_run_lookup_failed",
      }),
    ).resolves.toBe("failed");
  });
});
