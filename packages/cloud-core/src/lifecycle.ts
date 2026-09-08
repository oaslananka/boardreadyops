export type GitHubAppWebhookEvent =
  | "check_run"
  | "installation"
  | "installation_repositories"
  | "ping"
  | "pull_request";

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

function pullRequestSafeMode(
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

function normalizeCheckRunEvent(
  options: NormalizeGitHubAppWebhookOptions,
  payload: Record<string, unknown>,
  action: string | undefined,
  installation: GitHubInstallationRef,
): GitHubAppLifecycleResult {
  const repository = repositoryFromPayload(payload.repository);
  if (!repository) {
    return unsupported(options, "payload does not include a valid repository");
  }

  const checkRun = payload.check_run;
  if (!isRecord(checkRun)) {
    return unsupported(options, "payload does not include a valid check_run");
  }

  const checkRunId = numberValue(checkRun, "id");
  const checkSuite = checkRun.check_suite;
  const pullRequests = isRecord(checkSuite) ? arrayValue(checkSuite, "pull_requests") : [];
  const firstPr =
    pullRequests.length > 0 && isRecord(pullRequests[0]) ? (pullRequests[0] as Record<string, unknown>) : undefined;

  if (
    action === "rerequested" ||
    (action === "requested_action" &&
      isRecord(payload.requested_action) &&
      payload.requested_action.identifier === "rerun_checks")
  ) {
    if (!firstPr) {
      return result(options, action, []);
    }
    const pullRequestNumber = numberValue(firstPr, "number");
    const commitSha = pullRequestCommitSha(firstPr) ?? stringValue(checkRun, "head_sha");
    const baseCommitSha = pullRequestBaseCommitSha(firstPr);
    const ref = pullRequestRef(firstPr);

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

  if (action === "requested_action") {
    const requestedAction = payload.requested_action;
    const identifier = isRecord(requestedAction) ? stringValue(requestedAction, "identifier") : undefined;

    if (identifier === "create_setup_pr") {
      return result(options, action, [
        {
          type: "setup_pr.create",
          installation,
          repository,
          ...(checkRunId !== undefined ? { checkRunId } : {}),
        },
      ]);
    }

    if (identifier === "request_waiver") {
      return result(options, action, [
        {
          type: "waiver_pr.request",
          installation,
          repository,
          ...(checkRunId !== undefined ? { checkRunId } : {}),
        },
      ]);
    }

    if (identifier === "prepare_release") {
      return result(options, action, [
        {
          type: "release.prepare",
          installation,
          repository,
          ...(checkRunId !== undefined ? { checkRunId } : {}),
        },
      ]);
    }

    return result(options, action, []);
  }

  return result(options, action, []);
}

export function normalizeGitHubAppWebhook(options: NormalizeGitHubAppWebhookOptions): GitHubAppLifecycleResult {
  if (!isRecord(options.payload)) {
    return unsupported(options, "payload must be a JSON object");
  }

  const action = stringValue(options.payload, "action");

  if (options.event === "ping") {
    return result(options, action, []);
  }

  const installation = installationFromPayload(options.payload);

  if (!installation) {
    return unsupported(options, "payload does not include a valid installation");
  }

  if (options.event === "installation") {
    return normalizeInstallationEvent(options, options.payload, action, installation);
  }

  if (options.event === "installation_repositories") {
    return normalizeInstallationRepositoriesEvent(options, options.payload, action, installation);
  }

  if (options.event === "check_run") {
    return normalizeCheckRunEvent(options, options.payload, action, installation);
  }

  if (options.event === "pull_request") {
    if (!isQueuedPullRequestAction(action)) {
      return result(options, action, []);
    }

    const repository = repositoryFromPayload(options.payload.repository);
    const pullRequest = options.payload.pull_request;

    if (!repository || !isRecord(pullRequest)) {
      return unsupported(options, "payload does not include a valid repository and pull request");
    }

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

    if (safeMode) {
      enqueueAction.safeMode = safeMode;
    }

    return result(options, action, [
      {
        type: "installation.upsert",
        installation,
      },
      {
        type: "repository.upsert",
        installation,
        repository,
      },
      enqueueAction,
    ]);
  }

  return unsupported(options, `unsupported GitHub App event: ${options.event}`);
}
