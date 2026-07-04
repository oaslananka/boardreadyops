export type GitHubAppWebhookEvent = "installation" | "installation_repositories" | "ping" | "pull_request";

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
      type: "release_run.enqueue";
      installation: GitHubInstallationRef;
      repository: GitHubRepositoryRef;
      pullRequestNumber: number;
      ref: string;
      commitSha: string;
      triggerKind: "pr";
    };

export type GitHubAppLifecycleResult = {
  accepted: boolean;
  event: string;
  delivery: string;
  action?: string;
  reason?: string;
  actions: GitHubAppLifecycleAction[];
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

function pullRequestCommitSha(pullRequest: Record<string, unknown>): string | null {
  const head = pullRequest.head;

  if (!isRecord(head)) {
    return null;
  }

  return stringValue(head, "sha") ?? null;
}

function pullRequestRef(pullRequest: Record<string, unknown>): string | null {
  const head = pullRequest.head;

  if (!isRecord(head)) {
    return null;
  }

  return stringValue(head, "ref") ?? null;
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
    const repositories = arrayValue(options.payload, "repositories").flatMap((repository) => {
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

  if (options.event === "installation_repositories") {
    return result(options, action, [
      ...arrayValue(options.payload, "repositories_added").flatMap((repository) => {
        const parsed = repositoryFromPayload(repository);
        return parsed ? [{ type: "repository.upsert" as const, installation, repository: parsed }] : [];
      }),
      ...arrayValue(options.payload, "repositories_removed").flatMap((repository) => {
        const parsed = repositoryFromPayload(repository);
        return parsed ? [{ type: "repository.removed" as const, installation, repository: parsed }] : [];
      }),
    ]);
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
    const commitSha = pullRequestCommitSha(pullRequest);
    const ref = pullRequestRef(pullRequest);

    if (pullRequestNumber === undefined || !commitSha || !ref) {
      return unsupported(options, "pull request payload does not include number, head sha, and head ref");
    }

    return result(options, action, [
      {
        type: "release_run.enqueue",
        installation,
        repository,
        pullRequestNumber,
        ref,
        commitSha,
        triggerKind: "pr",
      },
    ]);
  }

  return unsupported(options, `unsupported GitHub App event: ${options.event}`);
}
