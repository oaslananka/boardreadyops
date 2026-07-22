import { describe, expect, it } from "vitest";
import {
  type ClaimedControlPlaneOutboxEffect,
  createSqlControlPlaneOutboxStore,
} from "../../../packages/db/src/control-plane-outbox-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const createEffect: ClaimedControlPlaneOutboxEffect = {
  outboxId: "outbox-create",
  releaseRunId: "run-1",
  effectType: "github.check_run.create",
  payloadVersion: 1,
  idempotencyKey: "github.check_run.create:run-1",
  attemptCount: 1,
  payload: {
    version: 1,
    type: "github.check_run.create",
    runId: "run-1",
    idempotencyKey: "repo:42:sha",
    action: {
      type: "release_run.enqueue",
      installation: { id: 12345 },
      repository: {
        id: 98765,
        owner: "octo-org",
        name: "hardware-board",
        fullName: "octo-org/hardware-board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 42,
      ref: "feature/ready",
      commitSha: "0123456789abcdef",
      triggerKind: "pr",
    },
  },
};

const workflowEffect: ClaimedControlPlaneOutboxEffect = {
  outboxId: "outbox-dispatch",
  releaseRunId: "run-1",
  executionAttemptId: "attempt-1",
  effectType: "github.workflow.dispatch",
  payloadVersion: 1,
  idempotencyKey: "github.workflow.dispatch:attempt-1",
  attemptCount: 1,
  payload: {
    version: 1,
    type: "github.workflow.dispatch",
    input: {
      action:
        createEffect.payload.type === "github.check_run.create"
          ? createEffect.payload.action
          : neverAction(),
      runId: "run-1",
      idempotencyKey: "repo:42:sha",
      githubCheckRunId: 77,
      executionAttemptId: "attempt-1",
    },
  },
};

function neverAction(): never {
  throw new Error("unreachable");
}

describe("control-plane outbox transition store", () => {
  it("completes Check Run creation and plans workflow dispatch atomically", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return {
          rows: [
            {
              transition_outcome: "completed",
              next_effect_type: "github.workflow.dispatch",
              next_outbox_id: "outbox-dispatch",
              execution_attempt_id: "attempt-1",
            },
          ],
        };
      },
    };
    const store = createSqlControlPlaneOutboxStore(executor, {
      now: () => new Date("2026-07-22T02:00:00.000Z"),
    });

    await expect(
      store.completeCheckRunCreateEffect({
        effect: createEffect,
        workerId: "worker-1",
        githubCheckRunId: 77,
        dispatchMode: "github-actions",
        executionAttemptId: "attempt-1",
        nextOutboxId: "outbox-dispatch",
      }),
    ).resolves.toEqual({
      outcome: "completed",
      nextEffectType: "github.workflow.dispatch",
      nextOutboxId: "outbox-dispatch",
      executionAttemptId: "attempt-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("boardreadyops_complete_check_run_create_effect");
    expect(calls[0]?.params).toContain("github.workflow.dispatch:attempt-1");
    expect(String(calls[0]?.params.at(-2))).toContain('"githubCheckRunId":77');
  });

  it("records the real GitHub workflow run ID with outbox completion", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params = []) {
        expect(sql).toContain("boardreadyops_complete_workflow_dispatch_effect");
        expect(params).toContain("456789");
        return { rows: [{ outcome: "completed" }] };
      },
    };
    const store = createSqlControlPlaneOutboxStore(executor, {
      now: () => new Date("2026-07-22T02:01:00.000Z"),
    });

    await expect(
      store.completeWorkflowDispatchEffect({
        effect: workflowEffect,
        workerId: "worker-1",
        workflowDispatchId: "456789",
        workflowRunUrl: "https://github.test/octo/actions/runs/456789",
      }),
    ).resolves.toBe("completed");
  });
});
