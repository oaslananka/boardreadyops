import { describe, expect, it } from "vitest";
import { createControlPlaneRunTransitionStore } from "../../../packages/db/src/control-plane-run-transition-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const transitionedAt = new Date("2026-07-27T05:00:00.000Z");

describe("control-plane run transition store", () => {
  it("binds a guarded run and current-attempt transition", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_transition_release_run_state");
        expect(params).toEqual([
          "run-1",
          "dispatched",
          4,
          "attempt-2",
          "running",
          "workflow_started",
          "2026-07-27T05:00:00.000Z",
          "dispatched",
          2,
          "in_progress",
        ]);
        return {
          rows: [
            {
              transition_outcome: "applied",
              run_status: "running",
              run_version: "5",
              attempt_status: "in_progress",
              attempt_version: "3",
            },
          ],
        };
      },
    };

    await expect(
      createControlPlaneRunTransitionStore(executor).transition({
        releaseRunId: "run-1",
        expectedRunStatus: "dispatched",
        expectedRunVersion: 4,
        expectedExecutionAttemptId: "attempt-2",
        expectedAttemptStatus: "dispatched",
        expectedAttemptVersion: 2,
        nextRunStatus: "running",
        nextAttemptStatus: "in_progress",
        reasonCode: "workflow_started",
        transitionedAt,
      }),
    ).resolves.toEqual({
      outcome: "applied",
      runStatus: "running",
      runVersion: 5,
      attemptStatus: "in_progress",
      attemptVersion: 3,
    });
  });

  it("supports a run-only transition while binding the current attempt pointer", async () => {
    const executor: SqlQueryExecutor = {
      async query(_sql, params) {
        expect(params).toEqual([
          "run-1",
          "running",
          7,
          "attempt-3",
          "timed_out",
          "execution_deadline_exceeded",
          "2026-07-27T05:00:00.000Z",
          null,
          null,
          null,
        ]);
        return {
          rows: [
            {
              transition_outcome: "applied",
              run_status: "timed_out",
              run_version: 8,
              attempt_status: "in_progress",
              attempt_version: 4,
            },
          ],
        };
      },
    };

    await expect(
      createControlPlaneRunTransitionStore(executor).transition({
        releaseRunId: "run-1",
        expectedRunStatus: "running",
        expectedRunVersion: 7,
        expectedExecutionAttemptId: "attempt-3",
        nextRunStatus: "timed_out",
        reasonCode: "execution_deadline_exceeded",
        transitionedAt,
      }),
    ).resolves.toEqual({
      outcome: "applied",
      runStatus: "timed_out",
      runVersion: 8,
      attemptStatus: "in_progress",
      attemptVersion: 4,
    });
  });

  it("decodes stable stale, missing, and invalid outcomes", async () => {
    const rows = [
      {
        transition_outcome: "stale",
        run_status: "running",
        run_version: "9",
        attempt_status: "in_progress",
        attempt_version: "4",
      },
      { transition_outcome: "not_found" },
      {
        transition_outcome: "invalid_transition",
        run_status: "completed",
        run_version: 10,
      },
    ];
    const executor: SqlQueryExecutor = {
      async query() {
        return { rows: [rows.shift() ?? {}] };
      },
    };
    const store = createControlPlaneRunTransitionStore(executor);
    const input = {
      releaseRunId: "run-1",
      expectedRunStatus: "running" as const,
      expectedRunVersion: 8,
      expectedExecutionAttemptId: "attempt-1",
      nextRunStatus: "completed" as const,
      reasonCode: "runner_result_received",
      transitionedAt,
    };

    await expect(store.transition(input)).resolves.toEqual({
      outcome: "stale",
      runStatus: "running",
      runVersion: 9,
      attemptStatus: "in_progress",
      attemptVersion: 4,
    });
    await expect(store.transition(input)).resolves.toEqual({ outcome: "not_found" });
    await expect(store.transition(input)).resolves.toEqual({
      outcome: "invalid_transition",
      runStatus: "completed",
      runVersion: 10,
    });
  });

  it("rejects malformed identifiers, versions, statuses, reasons, and dates before querying", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        throw new Error("unexpected query");
      },
    };
    const store = createControlPlaneRunTransitionStore(executor);
    const valid = {
      releaseRunId: "run-1",
      expectedRunStatus: "queued" as const,
      expectedRunVersion: 0,
      nextRunStatus: "dispatched" as const,
      reasonCode: "workflow_dispatch_requested",
      transitionedAt,
    };

    await expect(store.transition({ ...valid, releaseRunId: "bad run" })).rejects.toThrow("invalid release run id");
    await expect(store.transition({ ...valid, expectedRunVersion: -1 })).rejects.toThrow(
      "expected run version must be a non-negative safe integer",
    );
    await expect(store.transition({ ...valid, expectedRunStatus: "unknown" as never })).rejects.toThrow(
      "unsupported expected run status",
    );
    await expect(store.transition({ ...valid, reasonCode: "Bad Reason" })).rejects.toThrow(
      "invalid transition reason code",
    );
    await expect(store.transition({ ...valid, transitionedAt: new Date("invalid") })).rejects.toThrow(
      "transitionedAt must be a valid date",
    );
    await expect(
      store.transition({
        ...valid,
        expectedExecutionAttemptId: "attempt-1",
        expectedAttemptStatus: "dispatching",
      }),
    ).rejects.toThrow("attempt transition requires expected status, expected version, and next status");
  });

  it("rejects malformed database rows", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        return {
          rows: [
            {
              transition_outcome: "applied",
              run_status: "running",
              run_version: "not-a-number",
            },
          ],
        };
      },
    };

    await expect(
      createControlPlaneRunTransitionStore(executor).transition({
        releaseRunId: "run-1",
        expectedRunStatus: "dispatched",
        expectedRunVersion: 1,
        nextRunStatus: "running",
        reasonCode: "workflow_started",
        transitionedAt,
      }),
    ).rejects.toThrow("invalid run transition result");
  });
});
