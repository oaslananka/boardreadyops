import { describe, expect, it, vi } from "vitest";
import { processControlPlaneOutboxEffect } from "../../../apps/web/lib/control-plane-outbox-worker.js";
import type {
  ClaimedControlPlaneOutboxEffect,
  ControlPlaneOutboxStore,
} from "../../../packages/db/src/control-plane-outbox-store.js";

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

function store() {
  return {
    markDeliveryStarted: vi.fn(async () => "started" as const),
    completeCheckRunCreateEffect: vi.fn(async () => ({ outcome: "completed" as const })),
    completeWorkflowDispatchEffect: vi.fn(async () => "completed" as const),
    completeEffect: vi.fn(async () => "completed" as const),
    failEffect: vi.fn(async (input: { deliveryUncertain?: boolean }) =>
      input.deliveryUncertain === true ? "reconciliation_required" : "retry",
    ),
  } as unknown as ControlPlaneOutboxStore;
}

describe("control-plane outbox effect processor", () => {
  it("ensures the Check Run before atomically planning the next effect", async () => {
    const outbox = store();
    const ensurePullRequestCheckRun = vi.fn(async () => ({ id: 77 }));

    await expect(
      processControlPlaneOutboxEffect(createEffect, {
        workerId: "worker-1",
        outbox,
        dispatchMode: "github-actions",
        checkRuns: {
          ensurePullRequestCheckRun,
          completeCheckRun: vi.fn(async () => undefined),
        },
        workflowDispatch: {
          dispatchReleaseRunWorkflow: vi.fn(),
        },
        id: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("outbox-dispatch"),
      }),
    ).resolves.toMatchObject({ status: "completed" });

    expect(outbox.markDeliveryStarted).toHaveBeenCalledBefore(ensurePullRequestCheckRun);
    expect(outbox.completeCheckRunCreateEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        effect: createEffect,
        githubCheckRunId: 77,
        executionAttemptId: "attempt-1",
        nextOutboxId: "outbox-dispatch",
      }),
    );
  });

  it("quarantines a workflow dispatch when network delivery is uncertain", async () => {
    const outbox = store();
    const workflowEffect: ClaimedControlPlaneOutboxEffect = {
      outboxId: "outbox-dispatch",
      releaseRunId: "run-1",
      executionAttemptId: "attempt-1",
      effectType: "github.workflow.dispatch",
      payloadVersion: 1,
      idempotencyKey: "github.workflow.dispatch:attempt-1",
      attemptCount: 2,
      payload: {
        version: 1,
        type: "github.workflow.dispatch",
        input: {
          action: createEffect.payload.type === "github.check_run.create" ? createEffect.payload.action : neverAction(),
          runId: "run-1",
          idempotencyKey: "repo:42:sha",
          githubCheckRunId: 77,
          executionAttemptId: "attempt-1",
        },
      },
    };
    const error = Object.assign(new Error("socket closed"), { deliveryUncertain: true });

    await expect(
      processControlPlaneOutboxEffect(workflowEffect, {
        workerId: "worker-1",
        outbox,
        dispatchMode: "github-actions",
        checkRuns: {
          ensurePullRequestCheckRun: vi.fn(),
          completeCheckRun: vi.fn(),
        },
        workflowDispatch: {
          dispatchReleaseRunWorkflow: vi.fn(async () => {
            throw error;
          }),
        },
        id: vi.fn(),
      }),
    ).resolves.toMatchObject({ status: "reconciliation_required" });

    expect(outbox.failEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: "outbox-dispatch",
        attemptCount: 2,
        deliveryUncertain: true,
      }),
    );
  });
});

function neverAction(): never {
  throw new Error("unreachable");
}
