import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createScopedConcurrencyGate,
  jobCorrelation,
  outboxCorrelation,
  sanitizeWorkerLogFields,
  workerScopeFromJob,
  workerScopeFromOutboxEffect,
  workerScopeFromReconciliationItem,
} from "../../../apps/web/lib/control-plane-worker-runtime.js";
import type { ClaimedControlPlaneJob } from "../../../packages/db/src/control-plane-job-store.js";
import type { ClaimedControlPlaneReconciliationItem } from "../../../packages/db/src/control-plane-operations-store.js";
import type { ClaimedControlPlaneOutboxEffect } from "../../../packages/db/src/control-plane-outbox-store.js";

const releaseAction = {
  type: "release_run.enqueue" as const,
  installation: { id: 123 },
  repository: {
    id: 456,
    owner: "octo",
    name: "board",
    fullName: "octo/board",
    private: false,
    defaultBranch: "main",
  },
  pullRequestNumber: 7,
  ref: "feature/board",
  commitSha: "a".repeat(40),
  triggerKind: "pr" as const,
};

const job: ClaimedControlPlaneJob = {
  jobId: "job-1",
  inboxId: "inbox-1",
  jobType: "github_webhook.lifecycle",
  payloadVersion: 1,
  attemptCount: 1,
  eventType: "pull_request",
  eventAction: "opened",
  deliveryId: "delivery-1",
  actions: [releaseAction],
};

const effect: ClaimedControlPlaneOutboxEffect = {
  outboxId: "outbox-1",
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
      action: releaseAction,
      runId: "run-1",
      idempotencyKey: "release-run:octo/board:7",
      githubCheckRunId: 99,
      executionAttemptId: "attempt-1",
    },
  },
};

const lifecycleReconciliationItem: ClaimedControlPlaneReconciliationItem = {
  reconciliationId: "reconciliation-1",
  installationId: "installation-1",
  repositoryId: "repository-1",
  subjectType: "webhook_inbox",
  subjectId: "inbox-1",
  reasonCode: "lifecycle_job_missing",
  deadlineAt: "2026-07-24T02:00:00.000Z",
  nextCheckAt: "2026-07-24T01:30:00.000Z",
  attemptCount: 1,
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function workerSource(): string {
  return readFileSync(new URL("../../../apps/web/worker.ts", import.meta.url), "utf8");
}

describe("control-plane worker runtime", () => {
  it("extracts complete safe correlation from lifecycle jobs", () => {
    expect(jobCorrelation(job)).toEqual({
      deliveryId: "delivery-1",
      installationId: 123,
      repositoryId: 456,
      repository: "octo/board",
      jobId: "job-1",
    });
    expect(workerScopeFromJob(job)).toEqual({ installationId: 123, repositoryId: 456 });
  });

  it("extracts tenant scope from reconciliation items without subject data", () => {
    expect(workerScopeFromReconciliationItem(lifecycleReconciliationItem)).toEqual({
      installationId: "installation-1",
      repositoryId: "repository-1",
    });
  });

  it("extracts complete safe correlation from outbox effects", () => {
    expect(outboxCorrelation(effect)).toEqual({
      installationId: 123,
      repositoryId: 456,
      repository: "octo/board",
      releaseRunId: "run-1",
      executionAttemptId: "attempt-1",
      outboxId: "outbox-1",
      effectType: "github.workflow.dispatch",
    });
    expect(workerScopeFromOutboxEffect(effect)).toEqual({ installationId: 123, repositoryId: 456 });
  });

  it("redacts sensitive fields and credential-like strings recursively", () => {
    const sanitized = sanitizeWorkerLogFields({
      safe: "visible",
      token: "ghs_secret",
      oidcEnvelope: { subject: "repo:octo/board" },
      signedCapability: "capability-value",
      repositorySource: "private source code",
      sensitiveFindings: [{ evidence: "secret board detail" }],
      nested: {
        authorization: "Bearer abc.def.ghi",
        message: "request failed authorization=Bearer-token secret=hidden password=hunter2",
      },
      oversized: "x".repeat(3_000),
    });

    expect(sanitized).toMatchObject({
      safe: "visible",
      token: "[REDACTED]",
      oidcEnvelope: "[REDACTED]",
      signedCapability: "[REDACTED]",
      repositorySource: "[REDACTED]",
      sensitiveFindings: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("ghs_secret");
    expect(JSON.stringify(sanitized)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(sanitized)).not.toContain("hidden");
    expect(JSON.stringify(sanitized)).not.toContain("hunter2");
    expect(String(sanitized.oversized)).toHaveLength(2_000);
  });

  it("limits concurrent work per installation and repository without blocking unrelated repositories", async () => {
    const gate = createScopedConcurrencyGate({ installationLimit: 2, repositoryLimit: 1 });
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const started: string[] = [];
    const scopeA = { installationId: 123, repositoryId: 456 };
    const scopeB = { installationId: 123, repositoryId: 789 };

    const firstRun = gate.run(scopeA, async () => {
      started.push("first");
      await first.promise;
    });
    const secondRun = gate.run(scopeA, async () => {
      started.push("second");
      await second.promise;
    });
    const thirdRun = gate.run(scopeB, async () => {
      started.push("third");
      await third.promise;
    });

    await settle();
    expect(started).toEqual(["first", "third"]);
    expect(gate.snapshot()).toEqual({ active: 2, waiting: 1 });

    first.resolve();
    await firstRun;
    await settle();
    expect(started).toEqual(["first", "third", "second"]);
    expect(gate.snapshot()).toEqual({ active: 2, waiting: 0 });

    second.resolve();
    third.resolve();
    await Promise.all([secondRun, thirdRun]);
    expect(gate.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("wires privacy-safe control-plane SLI collection into maintenance", () => {
    const source = workerSource();

    expect(source).toContain("createSqlControlPlaneOperationsStore");
    expect(source).toContain("operations.collectSliSnapshot()");
    expect(source).toContain("createControlPlaneSloEvaluator");
    expect(source).toContain("controlPlaneSlo.evaluate(snapshot)");
    expect(source).toContain('"worker.control_plane_sli"');
    expect(source).toContain('"worker.control_plane_sli_failed"');
    expect(source).toContain('"worker.control_plane_slo_evaluation"');
    expect(source).toContain('"worker.control_plane_slo_firing"');
    expect(source).toContain('"worker.control_plane_slo_recovered"');
    expect(source).toContain('"worker.control_plane_slo_failed"');
  });

  it("wires lifecycle reconciliation independently from GitHub clients", () => {
    const source = workerSource();

    expect(source).toContain("operations.detectLifecycleReconciliationCandidates");
    expect(source).toContain("operations.claimLifecycleReconciliationItems");
    expect(source).toContain("processControlPlaneLifecycleReconciliation");
    expect(source).toContain("runLifecycleReconciliationLoop()");
    expect(source).toContain('"worker.lifecycle_reconciliation_detected"');
    expect(source).toContain('"worker.lifecycle_reconciliation_detection_failed"');
    expect(source).toContain('"worker.lifecycle_reconciliation_claim_failed"');
    expect(source).toContain('"worker.lifecycle_reconciliation_terminal"');
    expect(source).toContain("lastLifecycleReconciliationPollAt");
    expect(source).toContain("lastSuccessfulLifecycleReconciliationAt");

    const lifecycleLoopStart = source.indexOf("async function runLifecycleReconciliationLoop");
    const githubLoopStart = source.indexOf("async function runGitHubReconciliationLoop");
    const lifecycleLoop = source.slice(lifecycleLoopStart, githubLoopStart);
    expect(lifecycleLoopStart).toBeGreaterThanOrEqual(0);
    expect(githubLoopStart).toBeGreaterThan(lifecycleLoopStart);
    expect(lifecycleLoop).not.toContain("workflowReconciliation");
    expect(lifecycleLoop).not.toContain("checkRunReconciliation");
  });

  it("wires workflow reconciliation detection and processing loops", () => {
    const source = workerSource();

    expect(source).toContain("operations.detectWorkflowReconciliationCandidates");
    expect(source).toContain("operations.claimWorkflowReconciliationItems");
    expect(source).toContain("processControlPlaneWorkflowReconciliation");
    expect(source).toContain("createGitHubWorkflowReconciliationClient");
    expect(source).toContain("reconciliation deadline must be greater than observation delay");
    expect(source).toContain('"worker.reconciliation_terminal"');
  });
  it("wires Check Run reconciliation detection and processing loops", () => {
    const source = workerSource();

    expect(source).toContain("operations.detectCheckRunReconciliationCandidates");
    expect(source).toContain("operations.claimCheckRunReconciliationItems");
    expect(source).toContain("processControlPlaneCheckRunReconciliation");
    expect(source).toContain('"worker.check_run_reconciliation_terminal"');
  });
});
