import { randomUUID } from "node:crypto";
import type { ReleaseRunFinding } from "@boardreadyops/contracts";
import type { GitHubAppLifecycleAction, GitHubAppLifecycleContext } from "./lifecycle.js";

export type EnqueueReleaseRunInput = Extract<GitHubAppLifecycleAction, { type: "release_run.enqueue" }>;

export type EnqueuedReleaseRun = {
  idempotencyKey: string;
  runId?: string;
  githubCheckRunId?: number | string | null;
  status?: string;
};

export type AttachGitHubCheckRunInput = {
  idempotencyKey: string;
  githubCheckRunId: number;
};

export type BindReleaseRunExecutionAttemptInput = {
  runId: string;
  executionAttemptId: string;
  startedAt: string;
};

export type MarkReleaseRunDispatchedInput = {
  runId: string;
  executionAttemptId: string;
  dispatchedAt: string;
  workflowDispatchId?: string;
};

export type MarkReleaseRunSkippedInput = {
  runId: string;
  completedAt: string;
};

export type CreatePullRequestCheckRunInput = {
  action: EnqueueReleaseRunInput;
  runId: string;
  idempotencyKey: string;
};

export type DispatchReleaseRunWorkflowInput = CreatePullRequestCheckRunInput & {
  githubCheckRunId: number | string;
  executionAttemptId: string;
};

export type GitHubCheckRunAnnotation = {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: "notice" | "warning" | "failure";
  message: string;
  startColumn?: number | undefined;
  endColumn?: number | undefined;
  title?: string | undefined;
  rawDetails?: string | undefined;
};

export type CompleteGitHubCheckRunInput = {
  installationId: string | number;
  repositoryOwner: string;
  repositoryName: string;
  checkRunId: string | number;
  runId: string;
  conclusion: "failure" | "neutral" | "success" | "timed_out";
  title: string;
  summary: string;
  completedAt?: string | undefined;
  // GitHub allows at most 50 annotations per API request; the client chunks this array and
  // makes one PATCH per chunk. See github-app-check-run-client.js#completeGitHubCheckRun.
  annotations?: GitHubCheckRunAnnotation[] | undefined;
};

function annotationLevelForFindingSeverity(
  severity: ReleaseRunFinding["severity"],
): GitHubCheckRunAnnotation["annotationLevel"] {
  switch (severity) {
    case "error":
    case "high":
      return "failure";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "notice";
  }
}

/**
 * Convert a ReleaseRunFinding (the wire/contracts shape, not src/core's CLI-only Finding) into a
 * GitHub Check Run annotation, or undefined if it has no line location -- GitHub annotations
 * require a file path and a line range to attach to in the diff view.
 *
 * Deliberately does not import src/core/cloud-findings.ts's CLI-side equivalent: apps/web never
 * depends on src/core (see docs/architecture/contract-versioning.md's isolation boundary), so
 * this cloud-side mapper works from ReleaseRunFinding's flat startLine/endLine fields instead of
 * the CLI's nested Finding.location.region shape.
 */
export function findingToCheckRunAnnotation(finding: ReleaseRunFinding): GitHubCheckRunAnnotation | undefined {
  if (finding.path === undefined || finding.startLine === undefined) {
    return undefined;
  }
  const endLine = finding.endLine ?? finding.startLine;
  return {
    path: finding.path,
    startLine: finding.startLine,
    endLine,
    annotationLevel: annotationLevelForFindingSeverity(finding.severity),
    message: finding.message,
    title: finding.ruleId,
    ...(finding.startColumn !== undefined ? { startColumn: finding.startColumn } : {}),
    ...(finding.endColumn !== undefined ? { endColumn: finding.endColumn } : {}),
  };
}

/** Maps findings to Check Run annotations, silently dropping findings with no line location. */
export function findingsToCheckRunAnnotations(findings: ReleaseRunFinding[]): GitHubCheckRunAnnotation[] {
  const annotations: GitHubCheckRunAnnotation[] = [];
  for (const finding of findings) {
    const annotation = findingToCheckRunAnnotation(finding);
    if (annotation) {
      annotations.push(annotation);
    }
  }
  return annotations;
}

export type GitHubAppCheckRunClient = {
  createPullRequestCheckRun(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
  completeCheckRun?: (input: CompleteGitHubCheckRunInput) => Promise<void>;
};

export type GitHubAppWorkflowDispatchClient = {
  dispatchReleaseRunWorkflow(input: DispatchReleaseRunWorkflowInput): Promise<{ workflowDispatchId?: string }>;
};

export type GitHubAppLifecycleStore = {
  upsertInstallation(
    action: Extract<GitHubAppLifecycleAction, { type: "installation.upsert" }>,
    context?: GitHubAppLifecycleContext,
  ): Promise<void>;
  deleteInstallation(
    action: Extract<GitHubAppLifecycleAction, { type: "installation.deleted" }>,
    context?: GitHubAppLifecycleContext,
  ): Promise<void>;
  suspendInstallation(
    action: Extract<GitHubAppLifecycleAction, { type: "installation.suspended" }>,
    context?: GitHubAppLifecycleContext,
  ): Promise<void>;
  unsuspendInstallation(
    action: Extract<GitHubAppLifecycleAction, { type: "installation.unsuspended" }>,
    context?: GitHubAppLifecycleContext,
  ): Promise<void>;
  upsertRepository(
    action: Extract<GitHubAppLifecycleAction, { type: "repository.upsert" }>,
    context?: GitHubAppLifecycleContext,
  ): Promise<void>;
  removeRepository(
    action: Extract<GitHubAppLifecycleAction, { type: "repository.removed" }>,
    context?: GitHubAppLifecycleContext,
  ): Promise<void>;
  enqueueReleaseRun(action: EnqueueReleaseRunInput): Promise<EnqueuedReleaseRun>;
  attachGitHubCheckRun(input: AttachGitHubCheckRunInput): Promise<void>;
  bindReleaseRunExecutionAttempt(input: BindReleaseRunExecutionAttemptInput): Promise<boolean>;
  markReleaseRunDispatched(input: MarkReleaseRunDispatchedInput): Promise<void>;
  markReleaseRunSkipped(input: MarkReleaseRunSkippedInput): Promise<void>;
};

export type GitHubAppLifecycleExecutionResult = {
  total: number;
  installationsUpserted: number;
  installationsDeleted: number;
  installationsSuspended: number;
  installationsUnsuspended: number;
  repositoriesUpserted: number;
  repositoriesRemoved: number;
  releaseRunsQueued: number;
  checkRunsCreated: number;
  checkRunsSkipped: number;
  workflowDispatchesCreated: number;
  workflowDispatchesSkipped: number;
};

export const emptyGitHubAppLifecycleExecutionResult = {
  total: 0,
  installationsUpserted: 0,
  installationsDeleted: 0,
  installationsSuspended: 0,
  installationsUnsuspended: 0,
  repositoriesUpserted: 0,
  repositoriesRemoved: 0,
  releaseRunsQueued: 0,
  checkRunsCreated: 0,
  checkRunsSkipped: 0,
  workflowDispatchesCreated: 0,
  workflowDispatchesSkipped: 0,
} as const satisfies GitHubAppLifecycleExecutionResult;

export function releaseRunIdempotencyKey(action: EnqueueReleaseRunInput): string {
  return [action.repository.id, action.pullRequestNumber, action.commitSha].join(":");
}

type DispatchSkipReason = {
  id: "draft-pull-request" | "fork-pull-request";
  label: string;
};

function dispatchSkipReason(action: EnqueueReleaseRunInput): DispatchSkipReason | undefined {
  if (action.pullRequestDraft) {
    return { id: "draft-pull-request", label: "draft pull request" };
  }

  if (action.pullRequestFromFork) {
    return { id: "fork-pull-request", label: "fork pull request safe mode" };
  }

  return undefined;
}

async function completeSkippedCheckRun(
  action: EnqueueReleaseRunInput,
  runId: string,
  checkRunId: number | string,
  reason: DispatchSkipReason,
  completedAt: string,
  checkRunClient: GitHubAppCheckRunClient,
): Promise<void> {
  if (!checkRunClient.completeCheckRun) {
    return;
  }

  await checkRunClient.completeCheckRun({
    installationId: action.installation.id,
    repositoryOwner: action.repository.owner,
    repositoryName: action.repository.name,
    checkRunId,
    runId,
    conclusion: "neutral",
    title: "BoardReadyOps release readiness skipped",
    summary: [
      "Trust mode: Safe (restricted).",
      `Reason: ${reason.label} (${reason.id}).`,
      "Runner dispatch: skipped.",
      "Managed evidence artifacts: unavailable.",
      "Result callback authority: unavailable.",
    ].join("\n"),
    completedAt,
  });
}

type PreparedCheckRun = {
  checkRunId: number | string;
  checkRunCreated: boolean;
};

async function prepareReleaseCheckRun(
  action: EnqueueReleaseRunInput,
  releaseRun: EnqueuedReleaseRun & { runId: string },
  store: GitHubAppLifecycleStore,
  result: GitHubAppLifecycleExecutionResult,
  checkRunClient?: GitHubAppCheckRunClient,
): Promise<PreparedCheckRun | undefined> {
  const existingCheckRunId = releaseRun.githubCheckRunId;
  if (existingCheckRunId !== undefined && existingCheckRunId !== null) {
    result.checkRunsSkipped += 1;
    return { checkRunId: existingCheckRunId, checkRunCreated: false };
  }
  if (!checkRunClient) {
    return undefined;
  }

  const checkRun = await checkRunClient.createPullRequestCheckRun({
    action,
    runId: releaseRun.runId,
    idempotencyKey: releaseRun.idempotencyKey,
  });
  await store.attachGitHubCheckRun({
    idempotencyKey: releaseRun.idempotencyKey,
    githubCheckRunId: checkRun.id,
  });
  result.checkRunsCreated += 1;
  return { checkRunId: checkRun.id, checkRunCreated: true };
}

async function executeReleaseRun(
  action: EnqueueReleaseRunInput,
  releaseRun: EnqueuedReleaseRun & { runId: string },
  store: GitHubAppLifecycleStore,
  result: GitHubAppLifecycleExecutionResult,
  checkRunClient?: GitHubAppCheckRunClient,
  workflowDispatchClient?: GitHubAppWorkflowDispatchClient,
): Promise<void> {
  const preparedCheckRun = await prepareReleaseCheckRun(action, releaseRun, store, result, checkRunClient);
  if (!preparedCheckRun) {
    result.workflowDispatchesSkipped += 1;
    return;
  }
  const { checkRunId, checkRunCreated } = preparedCheckRun;

  const skipReason = dispatchSkipReason(action);
  if (skipReason) {
    if (releaseRun.status === undefined || releaseRun.status === "queued") {
      const completedAt = new Date().toISOString();
      await store.markReleaseRunSkipped({ runId: releaseRun.runId, completedAt });
      if (checkRunClient) {
        await completeSkippedCheckRun(action, releaseRun.runId, checkRunId, skipReason, completedAt, checkRunClient);
      }
    } else if (releaseRun.status === "completed" && checkRunClient) {
      await completeSkippedCheckRun(
        action,
        releaseRun.runId,
        checkRunId,
        skipReason,
        new Date().toISOString(),
        checkRunClient,
      );
    }

    result.workflowDispatchesSkipped += 1;
    return;
  }

  if (!workflowDispatchClient) {
    result.workflowDispatchesSkipped += 1;
    return;
  }

  if (!checkRunCreated && releaseRun.status !== undefined && releaseRun.status !== "queued") {
    result.workflowDispatchesSkipped += 1;
    return;
  }

  const executionAttemptId = randomUUID();
  const attemptBound = await store.bindReleaseRunExecutionAttempt({
    runId: releaseRun.runId,
    executionAttemptId,
    startedAt: new Date().toISOString(),
  });

  if (!attemptBound) {
    result.workflowDispatchesSkipped += 1;
    return;
  }

  const dispatch = await workflowDispatchClient.dispatchReleaseRunWorkflow({
    action,
    runId: releaseRun.runId,
    idempotencyKey: releaseRun.idempotencyKey,
    githubCheckRunId: checkRunId,
    executionAttemptId,
  });
  await store.markReleaseRunDispatched({
    runId: releaseRun.runId,
    executionAttemptId,
    dispatchedAt: new Date().toISOString(),
    ...(dispatch.workflowDispatchId === undefined ? {} : { workflowDispatchId: dispatch.workflowDispatchId }),
  });
  result.workflowDispatchesCreated += 1;
}

export async function executeGitHubAppLifecycleActions(
  actions: readonly GitHubAppLifecycleAction[],
  store: GitHubAppLifecycleStore,
  checkRunClient?: GitHubAppCheckRunClient,
  workflowDispatchClient?: GitHubAppWorkflowDispatchClient,
): Promise<GitHubAppLifecycleExecutionResult> {
  const result: GitHubAppLifecycleExecutionResult = {
    ...emptyGitHubAppLifecycleExecutionResult,
    total: actions.length,
  };

  for (const action of actions) {
    switch (action.type) {
      case "installation.upsert":
        await store.upsertInstallation(action);
        result.installationsUpserted += 1;
        break;
      case "installation.deleted":
        await store.deleteInstallation(action);
        result.installationsDeleted += 1;
        break;
      case "installation.suspended":
        await store.suspendInstallation(action);
        result.installationsSuspended += 1;
        break;
      case "installation.unsuspended":
        await store.unsuspendInstallation(action);
        result.installationsUnsuspended += 1;
        break;
      case "repository.upsert":
        await store.upsertRepository(action);
        result.repositoriesUpserted += 1;
        break;
      case "repository.removed":
        await store.removeRepository(action);
        result.repositoriesRemoved += 1;
        break;
      case "release_run.enqueue": {
        const releaseRun = await store.enqueueReleaseRun(action);

        if (!releaseRun.runId) {
          result.checkRunsSkipped += 1;
          result.workflowDispatchesSkipped += 1;
          break;
        }

        result.releaseRunsQueued += 1;
        await executeReleaseRun(
          action,
          { ...releaseRun, runId: releaseRun.runId },
          store,
          result,
          checkRunClient,
          workflowDispatchClient,
        );
        break;
      }
      default: {
        const exhaustive: never = action;
        throw new Error(`Unsupported GitHub App lifecycle action: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return result;
}

export function createNoopGitHubAppLifecycleStore(): GitHubAppLifecycleStore {
  return {
    async upsertInstallation() {},
    async deleteInstallation() {},
    async suspendInstallation() {},
    async unsuspendInstallation() {},
    async upsertRepository() {},
    async removeRepository() {},
    async enqueueReleaseRun() {
      return { idempotencyKey: "noop" };
    },
    async attachGitHubCheckRun() {},
    async bindReleaseRunExecutionAttempt() {
      return false;
    },
    async markReleaseRunDispatched() {},
    async markReleaseRunSkipped() {},
  };
}
