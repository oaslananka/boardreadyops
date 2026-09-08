import {
  type CapabilityRequirement,
  checkCapabilityRequirement,
  evaluateAppCapabilities,
  type GitHubAppCapabilities,
} from "@boardreadyops/cloud-core/github-capabilities";
import {
  evaluateCommandAuthorization,
  executeParsedCommand,
  type ParsedGitHubCommand,
  parseGitHubCommand,
} from "@boardreadyops/cloud-core/github-command";
import {
  type GitHubAppLifecycleAction,
  type GitHubAppLifecycleContext,
  type PullRequestSafeMode,
  pullRequestSafeMode,
} from "@boardreadyops/cloud-core/lifecycle";
import { createAppAuth } from "@octokit/auth-app";

type GitHubCommandAction = Extract<GitHubAppLifecycleAction, { type: "github_command.execute" }>;

type PullRequestContext = {
  headCommitSha: string;
  headRef: string;
  baseCommitSha: string;
  pullRequestDraft: boolean;
  pullRequestFromFork: boolean;
  safeMode?: PullRequestSafeMode;
};

type InstallationAuthentication = {
  token: string;
  permissions: Record<string, string | undefined>;
};

type CommandResponseInput = {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  commentId: number;
  body: string;
};

type GitHubCommandApi = {
  readPullRequest(input: { owner: string; repo: string; pullRequestNumber: number }): Promise<PullRequestContext>;
  upsertResponse(input: CommandResponseInput): Promise<void>;
};

export type GitHubCommandLifecycleExecutor = {
  executeGitHubCommand(
    action: GitHubCommandAction,
    context: GitHubAppLifecycleContext,
  ): Promise<readonly GitHubAppLifecycleAction[]>;
};

export type GitHubCommandLifecycleExecutorDependencies = {
  authenticateInstallation(installationId: number): Promise<InstallationAuthentication>;
  api(token: string): GitHubCommandApi;
};

const shaPattern = /^[0-9a-f]{40,64}$/u;
const maximumCommentPages = 20;
const commentsPerPage = 100;

function commandCapabilityRequirement(command: ParsedGitHubCommand): CapabilityRequirement | undefined {
  if (command.kind === "rerun") return "dispatch_analysis";
  if (command.kind === "setup") return "setup_pr";
  if (command.kind === "waive") return "waiver_pr";
  return undefined;
}

function capabilityError(requirement: CapabilityRequirement, capabilities: GitHubAppCapabilities): string | undefined {
  const capability = checkCapabilityRequirement(capabilities, requirement);
  return capability.satisfied
    ? undefined
    : (capability.userExplanation ?? `Missing GitHub App permissions: ${capability.missingPermissions.join(", ")}`);
}

async function postResponse(
  action: GitHubCommandAction,
  api: GitHubCommandApi,
  capabilities: GitHubAppCapabilities,
  body: string,
): Promise<void> {
  const missingCommentCapability = capabilityError("pr_comment", capabilities);
  if (missingCommentCapability) throw new Error(missingCommentCapability);
  await api.upsertResponse({
    owner: action.repository.owner,
    repo: action.repository.name,
    pullRequestNumber: action.pullRequestNumber,
    commentId: action.commentId,
    body,
  });
}

export function createGitHubCommandLifecycleExecutor(
  dependencies: GitHubCommandLifecycleExecutorDependencies,
): GitHubCommandLifecycleExecutor {
  return {
    async executeGitHubCommand(action, _context) {
      const command = parseGitHubCommand(action.commentBody);
      if (!command) throw new Error("GitHub command payload is no longer parseable");

      const authorization = evaluateCommandAuthorization(command, action.authorAssociation);
      const authentication = await dependencies.authenticateInstallation(action.installation.id);
      const capabilities = evaluateAppCapabilities(authentication.permissions);
      const api = dependencies.api(authentication.token);

      if (!authorization.authorized) {
        await postResponse(action, api, capabilities, authorization.reason ?? "This command is not authorized.");
        return [];
      }

      if (command.kind === "waive" && !command.reason?.trim()) {
        await postResponse(
          action,
          api,
          capabilities,
          'The `--reason` argument is required for an audited waiver. Use `/boardreadyops waive <rule-id> --reason "<text>"`.',
        );
        return [];
      }

      const requirement = commandCapabilityRequirement(command);
      if (requirement) {
        const missingCapability = capabilityError(requirement, capabilities);
        if (missingCapability) {
          await postResponse(action, api, capabilities, missingCapability);
          return [];
        }
      }

      if (!capabilities.pullRequestsRead) {
        throw new Error("Reading pull request context requires Pull requests (read) permission.");
      }

      const pullRequest = await api.readPullRequest({
        owner: action.repository.owner,
        repo: action.repository.name,
        pullRequestNumber: action.pullRequestNumber,
      });
      const safeMode =
        pullRequest.safeMode ??
        pullRequestSafeMode(action.repository, pullRequest.pullRequestFromFork, pullRequest.pullRequestDraft);
      const plan = executeParsedCommand(command, {
        repository: action.repository,
        installation: action.installation,
        pullRequestNumber: action.pullRequestNumber,
        headCommitSha: pullRequest.headCommitSha,
        headRef: pullRequest.headRef,
        baseCommitSha: pullRequest.baseCommitSha,
        pullRequestDraft: pullRequest.pullRequestDraft,
        pullRequestFromFork: pullRequest.pullRequestFromFork,
        ...(safeMode ? { safeMode } : {}),
        author: action.commentAuthor,
      });

      if (plan.kind === "comment") {
        await postResponse(action, api, capabilities, plan.body);
        return [];
      }
      if (plan.kind === "action") return [plan.action];
      return plan.actions;
    },
  };
}

function requestHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

async function responseJson(response: Response, context: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${context} failed with status ${response.status}`);
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${context} returned invalid JSON`);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function readGitHubPullRequestContext(input: {
  apiBaseUrl: string;
  token: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  request?: typeof fetch;
}): Promise<PullRequestContext> {
  const request = input.request ?? fetch;
  const url = `${input.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${encodeURIComponent(String(input.pullRequestNumber))}`;
  const payload = record(
    await responseJson(
      await request(url, { method: "GET", headers: requestHeaders(input.token) }),
      "GitHub pull request lookup",
    ),
  );
  const head = record(payload?.head);
  const base = record(payload?.base);
  const headCommitSha = typeof head?.sha === "string" ? head.sha : undefined;
  const headRef = typeof head?.ref === "string" ? head.ref.trim() : undefined;
  const baseCommitSha = typeof base?.sha === "string" ? base.sha : undefined;
  if (
    !headCommitSha ||
    !shaPattern.test(headCommitSha) ||
    !headRef ||
    !baseCommitSha ||
    !shaPattern.test(baseCommitSha)
  ) {
    throw new Error("GitHub pull request lookup returned invalid head/base context");
  }
  const pullRequestDraft = payload?.draft === true;
  const headRepository = record(head?.repo);
  const headRepositoryName = typeof headRepository?.full_name === "string" ? headRepository.full_name : undefined;
  const pullRequestFromFork =
    headRepository?.fork === true ||
    (headRepositoryName !== undefined && headRepositoryName !== `${input.owner}/${input.repo}`);
  return { headCommitSha, headRef, baseCommitSha, pullRequestDraft, pullRequestFromFork };
}

function commandResponseMarker(commentId: number): string {
  return `<!-- boardreadyops:command-response:${commentId} -->`;
}

function commandResponseId(payload: unknown[], marker: string): number | undefined {
  for (const comment of payload) {
    const item = record(comment);
    if (typeof item?.id === "number" && typeof item.body === "string" && item.body.includes(marker)) {
      return item.id;
    }
  }
  return undefined;
}

async function findExistingCommandResponse(input: {
  request: typeof fetch;
  headers: Record<string, string>;
  commentsBase: string;
  marker: string;
}): Promise<number | undefined> {
  for (let page = 1; page <= maximumCommentPages; page += 1) {
    const payload = await responseJson(
      await input.request(`${input.commentsBase}?per_page=${commentsPerPage}&page=${page}`, {
        method: "GET",
        headers: input.headers,
      }),
      "GitHub command response lookup",
    );
    if (!Array.isArray(payload)) throw new Error("GitHub command response lookup returned an invalid comment list");
    const existingCommentId = commandResponseId(payload, input.marker);
    if (existingCommentId !== undefined) return existingCommentId;
    if (payload.length < commentsPerPage) return undefined;
  }
  throw new Error(`GitHub command response lookup exceeded ${maximumCommentPages * commentsPerPage} comments`);
}

export async function upsertGitHubCommandResponse(input: {
  apiBaseUrl: string;
  token: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  commentId: number;
  body: string;
  request?: typeof fetch;
}): Promise<void> {
  const request = input.request ?? fetch;
  const headers = requestHeaders(input.token);
  const marker = commandResponseMarker(input.commentId);
  const body = `${input.body.trimEnd()}\n\n${marker}`;
  const commentsBase = `${input.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${encodeURIComponent(String(input.pullRequestNumber))}/comments`;
  const existingCommentId = await findExistingCommandResponse({ request, headers, commentsBase, marker });

  const url =
    existingCommentId === undefined
      ? commentsBase
      : `${input.apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/comments/${existingCommentId}`;
  const method = existingCommentId === undefined ? "POST" : "PATCH";
  await responseJson(
    await request(url, { method, headers, body: JSON.stringify({ body }) }),
    existingCommentId === undefined ? "GitHub command response creation" : "GitHub command response update",
  );
}

export function createProductionGitHubCommandLifecycleExecutor(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GitHubCommandLifecycleExecutor | undefined {
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
  if (!appId || !privateKey) return undefined;
  const apiBaseUrl = (environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");

  return createGitHubCommandLifecycleExecutor({
    async authenticateInstallation(installationId) {
      const authenticate = createAppAuth({ appId, privateKey, installationId });
      const authentication = await authenticate({ type: "installation" });
      return { token: authentication.token, permissions: authentication.permissions };
    },
    api(token) {
      return {
        readPullRequest(input) {
          return readGitHubPullRequestContext({ apiBaseUrl, token, ...input });
        },
        upsertResponse(input) {
          return upsertGitHubCommandResponse({ apiBaseUrl, token, ...input });
        },
      };
    },
  });
}
