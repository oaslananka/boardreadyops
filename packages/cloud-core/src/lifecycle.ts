import { parseGitHubCommand } from "./github-command.js";
import { repositorySetupBranchName } from "./repository-setup.js";

export type GitHubAppWebhookEvent =
  | "check_run"
  | "installation"
  | "installation_repositories"
  | "issue_comment"
  | "ping"
  | "pull_request"
  | "pull_request_review"
  | "workflow_run";

export type GitHubRepositoryRef = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
};

export type GitHubInstallationRef = {
  id: number;
  accountLogin?: string;
  accountType?: string;
};

export type PullRequestSafeModeReason = "draft-pull-request" | "fork-pull-request" | "private-repository";

export type PullRequestSafeMode = {
  enabled: boolean;
  reasons: PullRequestSafeModeReason[];
};

export type GitHubAppLifecycleAction =
  | {
      type: "installation.upsert";
      installation: GitHubInstallationRef;
    }
  | {
      type: "installation.deleted";
      installation: GitHubInstallationRef;
    }
  | {
      type: "installation.suspended";
      installation: GitHubInstallationRef;
    }
  | {
      type: "installation.unsuspended";
      installation: GitHubInstallationRef;
    }
  | {
      type: "repository.upsert";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
    }
  | {
      type: "repository.removed";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
    }
  | {
      type: "setup_pr.create";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      checkRunId?: number | undefined;
      requestedBy?: string | undefined;
    }
  | {
      type: "setup_probe.dispatch";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      pullRequestNumber: number;
      commitSha: string;
      requestedBy?: string | undefined;
    }
  | {
      type: "waiver_pr.request";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      checkRunId?: number | undefined;
      ruleId?: string | undefined;
      reason?: string | undefined;
      requestedBy?: string | undefined;
    }
  | {
      type: "release.prepare";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      checkRunId?: number | undefined;
      pullRequestNumber: number;
      ref: string;
      commitSha: string;
      baseCommitSha?: string | undefined;
      pullRequestDraft?: boolean | undefined;
      pullRequestFromFork?: boolean | undefined;
      safeMode?: PullRequestSafeMode | undefined;
      requestedBy?: string | undefined;
    }
  | {
      type: "github_command.execute";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      pullRequestNumber: number;
      commentId: number;
      commentBody: string;
      commentAuthor: string;
      authorAssociation: string;
    }
  | {
      type: "pull_request_review.submitted";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      pullRequestNumber: number;
      reviewId: number;
      state: string;
      reviewer: string;
    }
  | {
      type: "workflow_run.progress";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      workflowRunId: number;
      workflowName: string;
      status: string;
      conclusion?: string | undefined;
    }
  | {
      type: "release_run.enqueue";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      pullRequestNumber: number;
      ref: string;
      commitSha: string;
      baseCommitSha?: string;
      triggerKind: "pr";
      pullRequestDraft?: boolean;
      pullRequestFromFork?: boolean;
      safeMode?: PullRequestSafeMode;
      /** The GitHub webhook delivery (`X-GitHub-Delivery`) that produced this run, for DB-only correlation. */
      deliveryId?: string | undefined;
      /** Optional explicit-request scope. Same scope retries dedupe; different scopes may re-evaluate the same commit. */
      idempotencyScope?: string | undefined;
      setupIncomplete?: boolean | undefined;
    };

export type GitHubAppLifecycleResult = {
  accepted: boolean;
  event: string;
  delivery: string;
  action?: string;
  reason?: string;
  actions: GitHubAppLifecycleAction[];
};

export type GitHubAppLifecycleContext = {
  deliveryId: string;
  eventType: string;
  eventAction?: string;
};

export type NormalizeGitHubAppWebhookOptions = {
  event: string;
  delivery: string;
  payload: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolValue(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function arrayValue(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function installationFromPayload(payload: Record<string, unknown>): GitHubInstallationRef | null {
  const installation = payload.installation;

  if (!isRecord(installation)) {
    return null;
  }

  const id = numberValue(installation, "id");

  if (id === undefined) {
    return null;
  }

  const account = installation.account;
  const result: GitHubInstallationRef = { id };

  if (isRecord(account)) {
    const accountLogin = stringValue(account, "login");
    const accountType = stringValue(account, "type");

    if (accountLogin) {
      result.accountLogin = accountLogin;
    }

    if (accountType) {
      result.accountType = accountType;
    }
  }

  return result;
}

function repositoryFromPayload(value: unknown): GitHubRepositoryRef | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = numberValue(value, "id");
  const name = stringValue(value, "name");
  const fullName = stringValue(value, "full_name");

  if (id === undefined || !name || !fullName) {
    return null;
  }

  const ownerRecord = value.owner;
  const owner = isRecord(ownerRecord) ? stringValue(ownerRecord, "login") : fullName.split("/")[0];

  if (!owner) {
    return null;
  }

  const repository: GitHubRepositoryRef = {
    id,
    owner,
    name,
    fullName,
    private: boolValue(value, "private") ?? false,
  };
  const defaultBranch = stringValue(value, "default_branch");

  if (defaultBranch) {
    repository.defaultBranch = defaultBranch;
  }

  return repository;
}

const fullLowercaseCommitSha = /^[0-9a-f]{40}$/u;

function pullRequestBaseCommitSha(pullRequest: Record<string, unknown>): string | null {
  const base = pullRequest.base;
  if (!isRecord(base)) return null;
  const sha = stringValue(base, "sha");
  return sha && fullLowercaseCommitSha.test(sha) ? sha : null;
}

function pullRequestCommitSha(pullRequest: Record<string, unknown>): string | null {
  const head = pullRequest.head;

  if (!isRecord(head)) {
    return null;
  }

  const sha = stringValue(head, "sha");
  return sha && fullLowercaseCommitSha.test(sha) ? sha : null;
}

function pullRequestRef(pullRequest: Record<string, unknown>): string | null {
  const head = pullRequest.head;

  if (!isRecord(head)) {
    return null;
  }

  return stringValue(head, "ref") ?? null;
}

function pullRequestBaseRef(pullRequest: Record<string, unknown>): string | null {
  const base = pullRequest.base;
  if (!isRecord(base)) return null;
  return stringValue(base, "ref") ?? null;
}

function pullRequestMergeCommitSha(pullRequest: Record<string, unknown>): string | null {
  const sha = stringValue(pullRequest, "merge_commit_sha");
  return sha && fullLowercaseCommitSha.test(sha) ? sha : null;
}

function pullRequestHeadRepository(pullRequest: Record<string, unknown>): string | undefined {
  const head = pullRequest.head;

  if (!isRecord(head) || !isRecord(head.repo)) {
    return undefined;
  }

  return stringValue(head.repo, "full_name");
}

function pullRequestHeadRepositoryIsFork(pullRequest: Record<string, unknown>): boolean {
  const head = pullRequest.head;

  if (!isRecord(head) || !isRecord(head.repo)) {
    return false;
  }

  return boolValue(head.repo, "fork") ?? false;
}

function pullRequestIsFromFork(repository: GitHubRepositoryRef, pullRequest: Record<string, unknown>): boolean {
  const headRepository = pullRequestHeadRepository(pullRequest);
  return (
    pullRequestHeadRepositoryIsFork(pullRequest) ||
    (headRepository !== undefined && headRepository !== repository.fullName)
  );
}

export function pullRequestSafeMode(
  repository: GitHubRepositoryRef,
  fromFork: boolean,
  draft: boolean,
): PullRequestSafeMode | undefined {
  const reasons: PullRequestSafeModeReason[] = [];

  if (draft) {
    reasons.push("draft-pull-request");
  }

  if (fromFork) {
    reasons.push("fork-pull-request");
  }

  if (repository.private) {
    reasons.push("private-repository");
  }

  return reasons.length > 0 ? { enabled: true, reasons } : undefined;
}

function isQueuedPullRequestAction(action: string | undefined): boolean {
  return action === "opened" || action === "reopened" || action === "synchronize" || action === "ready_for_review";
}

function unsupported(options: NormalizeGitHubAppWebhookOptions, reason: string): GitHubAppLifecycleResult {
  return {
    accepted: false,
    event: options.event,
    delivery: options.delivery,
    reason,
    actions: [],
  };
}

function result(
  options: NormalizeGitHubAppWebhookOptions,
  action: string | undefined,
  actions: GitHubAppLifecycleAction[],
): GitHubAppLifecycleResult {
  const lifecycleResult: GitHubAppLifecycleResult = {
    accepted: true,
    event: options.event,
    delivery: options.delivery,
    actions,
  };

  if (action) {
    lifecycleResult.action = action;
  }

  return lifecycleResult;
}

function normalizeInstallationEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  if (action === "suspend" || action === "unsuspend") {
    return result(options, action, [
      {
        type: action === "suspend" ? "installation.suspended" : "installation.unsuspended",
        installation,
      },
    ]);
  }

  const repositories = arrayValue(payload, "repositories").flatMap((repository) => {
    const parsed = repositoryFromPayload(repository);
    return parsed ? [parsed] : [];
  });
  const installationAction: GitHubAppLifecycleAction =
    action === "deleted"
      ? { type: "installation.deleted", installation }
      : { type: "installation.upsert", installation };

  return result(options, action, [
    installationAction,
    ...repositories.map(
      (repository): GitHubAppLifecycleAction => ({
        type: action === "deleted" ? "repository.removed" : "repository.upsert",
        installation,
        repository,
      }),
    ),
  ]);
}

function normalizeInstallationRepositoriesEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  return result(options, action, [
    ...arrayValue(payload, "repositories_added").flatMap((repository) => {
      const parsed = repositoryFromPayload(repository);
      return parsed ? [{ type: "repository.upsert" as const, installation, repository: parsed }] : [];
    }),
    ...arrayValue(payload, "repositories_removed").flatMap((repository) => {
      const parsed = repositoryFromPayload(repository);
      return parsed ? [{ type: "repository.removed" as const, installation, repository: parsed }] : [];
    }),
  ]);
}

function firstCheckRunPullRequest(checkRun: Record<string, unknown>): Record<string, unknown> | undefined {
  const checkSuite = checkRun.check_suite;
  const pullRequests = isRecord(checkSuite) ? arrayValue(checkSuite, "pull_requests") : [];
  const firstPullRequest = pullRequests[0];
  return isRecord(firstPullRequest) ? firstPullRequest : undefined;
}

function checkRunRequestsRerun(action: string | undefined, payload: Record<string, unknown>): boolean {
  if (action === "rerequested") return true;
  if (action !== "requested_action" || !isRecord(payload.requested_action)) return false;
  return payload.requested_action.identifier === "rerun_checks";
}

function normalizeCheckRunRerun(
  options: NormalizeGitHubAppWebhookOptions,
  action: string | undefined,
  installation: GitHubInstallationRef,
  repository: GitHubRepositoryRef,
  checkRun: Record<string, unknown>,
  pullRequest: Record<string, unknown> | undefined,
): GitHubAppLifecycleResult {
  if (!pullRequest) return result(options, action, []);

  const pullRequestNumber = numberValue(pullRequest, "number");
  const commitSha = pullRequestCommitSha(pullRequest) ?? stringValue(checkRun, "head_sha");
  const baseCommitSha = pullRequestBaseCommitSha(pullRequest);
  const ref = pullRequestRef(pullRequest);
  if (pullRequestNumber === undefined || !commitSha || !ref) {
    return unsupported(options, "check_run PR payload does not include number, head sha, or ref");
  }

  return result(options, action, [
    {
      type: "release_run.enqueue",
      installation,
      repository,
      pullRequestNumber,
      ref,
      commitSha,
      ...(baseCommitSha ? { baseCommitSha } : {}),
      triggerKind: "pr",
      deliveryId: options.delivery,
    },
  ]);
}

function normalizePrepareReleaseAction(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
  repository: GitHubRepositoryRef,
  checkRun: Record<string, unknown>,
  checkRunId: number | undefined,
  pullRequest: Record<string, unknown> | undefined,
): GitHubAppLifecycleResult {
  if (!pullRequest) return unsupported(options, "prepare_release requires pull request context");

  const pullRequestNumber = numberValue(pullRequest, "number");
  const commitSha = pullRequestCommitSha(pullRequest) ?? stringValue(checkRun, "head_sha");
  const baseCommitSha = pullRequestBaseCommitSha(pullRequest);
  const ref = pullRequestRef(pullRequest);
  if (pullRequestNumber === undefined || !commitSha || !ref) {
    return unsupported(options, "prepare_release PR payload does not include number, head sha, or ref");
  }

  const pullRequestFromFork = pullRequestIsFromFork(repository, pullRequest);
  const pullRequestDraft = boolValue(pullRequest, "draft") ?? false;
  const safeMode = pullRequestSafeMode(repository, pullRequestFromFork, pullRequestDraft);
  const requestedBy = isRecord(payload.sender) ? stringValue(payload.sender, "login") : undefined;
  return result(options, action, [
    {
      type: "release.prepare",
      installation,
      repository,
      ...(checkRunId !== undefined ? { checkRunId } : {}),
      pullRequestNumber,
      ref,
      commitSha,
      ...(baseCommitSha ? { baseCommitSha } : {}),
      pullRequestDraft,
      pullRequestFromFork,
      ...(safeMode ? { safeMode } : {}),
      ...(requestedBy ? { requestedBy } : {}),
    },
  ]);
}

function normalizeCheckRunRequestedAction(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
  repository: GitHubRepositoryRef,
  checkRun: Record<string, unknown>,
  checkRunId: number | undefined,
  pullRequest: Record<string, unknown> | undefined,
): GitHubAppLifecycleResult {
  const requestedAction = payload.requested_action;
  const identifier = isRecord(requestedAction) ? stringValue(requestedAction, "identifier") : undefined;
  const requestedBy = isRecord(payload.sender) ? stringValue(payload.sender, "login") : undefined;

  switch (identifier) {
    case "create_setup_pr":
      return result(options, action, [
        {
          type: "setup_pr.create",
          installation,
          repository,
          ...(checkRunId !== undefined ? { checkRunId } : {}),
          ...(requestedBy ? { requestedBy } : {}),
        },
      ]);
    case "request_waiver":
      return result(options, action, [
        {
          type: "waiver_pr.request",
          installation,
          repository,
          ...(checkRunId !== undefined ? { checkRunId } : {}),
        },
      ]);
    case "prepare_release":
      return normalizePrepareReleaseAction(
        options,
        payload,
        action,
        installation,
        repository,
        checkRun,
        checkRunId,
        pullRequest,
      );
    default:
      return result(options, action, []);
  }
}

function normalizeCheckRunEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  const repository = repositoryFromPayload(payload.repository);
  if (!repository) return unsupported(options, "payload does not include a valid repository");

  const checkRun = payload.check_run;
  if (!isRecord(checkRun)) return unsupported(options, "payload does not include a valid check_run");

  const pullRequest = firstCheckRunPullRequest(checkRun);
  if (checkRunRequestsRerun(action, payload)) {
    return normalizeCheckRunRerun(options, action, installation, repository, checkRun, pullRequest);
  }
  if (action !== "requested_action") return result(options, action, []);

  return normalizeCheckRunRequestedAction(
    options,
    payload,
    action,
    installation,
    repository,
    checkRun,
    numberValue(checkRun, "id"),
    pullRequest,
  );
}

function normalizeIssueCommentEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  if (action !== "created") {
    return result(options, action, []);
  }

  const issue = payload.issue;
  if (!isRecord(issue) || !isRecord(issue.pull_request)) {
    return result(options, action, []);
  }

  const comment = payload.comment;
  if (!isRecord(comment)) {
    return unsupported(options, "issue_comment payload does not include a valid comment");
  }

  const body = stringValue(comment, "body");
  if (!body) {
    return result(options, action, []);
  }

  const command = parseGitHubCommand(body);
  if (!command) {
    return result(options, action, []);
  }

  const repository = repositoryFromPayload(payload.repository);
  if (!repository) {
    return unsupported(options, "issue_comment payload does not include a valid repository");
  }

  const pullRequestNumber = numberValue(issue, "number");
  const commentId = numberValue(comment, "id");
  const commentUser = isRecord(comment.user) ? stringValue(comment.user, "login") : undefined;
  const commentUserType = isRecord(comment.user) ? stringValue(comment.user, "type") : undefined;
  const authorAssociation = stringValue(comment, "author_association") ?? "NONE";

  if (commentUserType?.toLowerCase() === "bot") {
    return result(options, action, []);
  }

  if (pullRequestNumber === undefined || commentId === undefined || !commentUser) {
    return unsupported(options, "issue_comment payload does not include PR number, comment id, or author");
  }

  return result(options, action, [
    {
      type: "github_command.execute",
      installation,
      repository,
      pullRequestNumber,
      commentId,
      commentBody: body,
      commentAuthor: commentUser,
      authorAssociation,
    },
  ]);
}

function normalizePullRequestReviewEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  if (action !== "submitted") {
    return result(options, action, []);
  }

  const repository = repositoryFromPayload(payload.repository);
  const pullRequest = payload.pull_request;
  const review = payload.review;

  if (!repository || !isRecord(pullRequest) || !isRecord(review)) {
    return unsupported(options, "pull_request_review payload does not include repository, pull_request, or review");
  }

  const pullRequestNumber = numberValue(pullRequest, "number");
  const reviewId = numberValue(review, "id");
  const state = stringValue(review, "state") ?? "unknown";
  const reviewer = isRecord(review.user) ? stringValue(review.user, "login") : undefined;

  if (pullRequestNumber === undefined || reviewId === undefined || !reviewer) {
    return unsupported(options, "pull_request_review payload does not include PR number, review id, or reviewer");
  }

  return result(options, action, [
    {
      type: "pull_request_review.submitted",
      installation,
      repository,
      pullRequestNumber,
      reviewId,
      state,
      reviewer,
    },
  ]);
}

function normalizeWorkflowRunEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  if (action !== "completed" && action !== "in_progress" && action !== "requested") {
    return result(options, action, []);
  }

  const repository = repositoryFromPayload(payload.repository);
  const workflowRun = payload.workflow_run;

  if (!repository || !isRecord(workflowRun)) {
    return unsupported(options, "workflow_run payload does not include repository or workflow_run");
  }

  const workflowRunId = numberValue(workflowRun, "id");
  const workflowName = stringValue(workflowRun, "name") ?? "workflow";
  const status = stringValue(workflowRun, "status") ?? "unknown";
  const conclusion = stringValue(workflowRun, "conclusion");

  if (workflowRunId === undefined) {
    return unsupported(options, "workflow_run payload does not include id");
  }

  const runAction: GitHubAppLifecycleAction = {
    type: "workflow_run.progress",
    installation,
    repository,
    workflowRunId,
    workflowName,
    status,
    ...(conclusion ? { conclusion } : {}),
  };

  return result(options, action, [runAction]);
}

function normalizeMergedSetupPullRequest(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
  repository: GitHubRepositoryRef,
  pullRequest: Record<string, unknown>,
): GitHubAppLifecycleResult {
  if (boolValue(pullRequest, "merged") !== true) return result(options, action, []);

  const headRef = pullRequestRef(pullRequest);
  const baseRef = pullRequestBaseRef(pullRequest);
  if (headRef !== repositorySetupBranchName || !repository.defaultBranch || baseRef !== repository.defaultBranch) {
    return result(options, action, []);
  }

  const pullRequestNumber = numberValue(pullRequest, "number");
  const commitSha = pullRequestMergeCommitSha(pullRequest);
  if (pullRequestNumber === undefined || !commitSha) {
    return unsupported(options, "merged setup pull request payload does not include number or merge commit sha");
  }

  const requestedBy = isRecord(payload.sender) ? stringValue(payload.sender, "login") : undefined;
  return result(options, action, [
    {
      type: "setup_probe.dispatch",
      installation,
      repository,
      pullRequestNumber,
      commitSha,
      ...(requestedBy ? { requestedBy } : {}),
    },
  ]);
}

function normalizeQueuedPullRequest(
  options: NormalizeGitHubAppWebhookOptions,
  action: string | undefined,
  installation: GitHubInstallationRef,
  repository: GitHubRepositoryRef,
  pullRequest: Record<string, unknown>,
): GitHubAppLifecycleResult {
  const pullRequestNumber = numberValue(pullRequest, "number");
  const baseCommitSha = pullRequestBaseCommitSha(pullRequest);
  const commitSha = pullRequestCommitSha(pullRequest);
  const ref = pullRequestRef(pullRequest);
  if (pullRequestNumber === undefined || !baseCommitSha || !commitSha || !ref) {
    return unsupported(options, "pull request payload does not include number, base sha, head sha, and head ref");
  }

  const pullRequestFromFork = pullRequestIsFromFork(repository, pullRequest);
  const pullRequestDraft = boolValue(pullRequest, "draft") ?? false;
  const enqueueAction: GitHubAppLifecycleAction = {
    type: "release_run.enqueue",
    installation,
    repository,
    pullRequestNumber,
    ref,
    commitSha,
    baseCommitSha,
    triggerKind: "pr",
    pullRequestDraft,
    pullRequestFromFork,
    deliveryId: options.delivery,
  };
  const safeMode = pullRequestSafeMode(repository, pullRequestFromFork, pullRequestDraft);
  if (safeMode) enqueueAction.safeMode = safeMode;

  return result(options, action, [
    { type: "installation.upsert", installation },
    { type: "repository.upsert", installation, repository },
    enqueueAction,
  ]);
}

function normalizePullRequestEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  const repository = repositoryFromPayload(payload.repository);
  const pullRequest = payload.pull_request;
  if (!repository || !isRecord(pullRequest)) {
    return unsupported(options, "payload does not include a valid repository and pull request");
  }

  if (action === "closed") {
    return normalizeMergedSetupPullRequest(options, payload, action, installation, repository, pullRequest);
  }
  if (!isQueuedPullRequestAction(action)) return result(options, action, []);
  return normalizeQueuedPullRequest(options, action, installation, repository, pullRequest);
}

function normalizeInstalledEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  switch (options.event) {
    case "installation":
      return normalizeInstallationEvent(options, payload, action, installation);
    case "installation_repositories":
      return normalizeInstallationRepositoriesEvent(options, payload, action, installation);
    case "check_run":
      return normalizeCheckRunEvent(options, payload, action, installation);
    case "issue_comment":
      return normalizeIssueCommentEvent(options, payload, action, installation);
    case "pull_request_review":
      return normalizePullRequestReviewEvent(options, payload, action, installation);
    case "workflow_run":
      return normalizeWorkflowRunEvent(options, payload, action, installation);
    case "pull_request":
      return normalizePullRequestEvent(options, payload, action, installation);
    default:
      return unsupported(options, `unsupported GitHub App event: ${options.event}`);
  }
}

export function normalizeGitHubAppWebhook(options: NormalizeGitHubAppWebhookOptions): GitHubAppLifecycleResult {
  if (!isRecord(options.payload)) return unsupported(options, "payload must be a JSON object");

  const action = stringValue(options.payload, "action");
  if (options.event === "ping") return result(options, action, []);

  const installation = installationFromPayload(options.payload);
  if (!installation) return unsupported(options, "payload does not include a valid installation");
  return normalizeInstalledEvent(options, options.payload, action, installation);
}
