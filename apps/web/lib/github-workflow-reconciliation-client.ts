import { createAppAuth } from "@octokit/auth-app";

export type GitHubWorkflowObservation =
  | { kind: "completed"; conclusion: string }
  | { kind: "not_found" }
  | { kind: "pending"; status: string };

export type GitHubWorkflowReconciliationClient = {
  readWorkflowRun(input: {
    githubInstallationId: number;
    repositoryOwner: string;
    repositoryName: string;
    workflowRunId: string;
  }): Promise<GitHubWorkflowObservation>;
};

type RequestFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type InstallationAuthenticator = (input: { type: "installation" }) => Promise<{ token: string }>;
type AuthFactory = (input: { appId: string; privateKey: string; installationId: number }) => InstallationAuthenticator;

const workflowStatePattern = /^[a-z][a-z0-9_]{0,63}$/u;
const workflowRunIdPattern = /^[1-9]\d{0,19}$/u;

function normalizedState(value: unknown, fallback: string): string {
  return typeof value === "string" && workflowStatePattern.test(value) ? value : fallback;
}

function requestHeaders(token: string): Readonly<Record<string, string>> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

export async function readGitHubWorkflowRun(input: {
  apiBaseUrl: string;
  token: string;
  repositoryOwner: string;
  repositoryName: string;
  workflowRunId: string;
  request?: RequestFunction;
}): Promise<GitHubWorkflowObservation> {
  if (!workflowRunIdPattern.test(input.workflowRunId)) throw new Error("invalid GitHub workflow run id");
  const request = input.request ?? fetch;
  const endpoint = `${input.apiBaseUrl.replace(/\/$/u, "")}/repos/${encodeURIComponent(
    input.repositoryOwner,
  )}/${encodeURIComponent(input.repositoryName)}/actions/runs/${encodeURIComponent(input.workflowRunId)}`;
  const response = await request(endpoint, {
    method: "GET",
    headers: requestHeaders(input.token),
  });

  if (response.status === 404) return { kind: "not_found" };
  if (!response.ok) throw new Error(`GitHub workflow lookup failed with status ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("GitHub workflow lookup returned an unreadable response");
  }
  if (typeof body !== "object" || body === null) {
    throw new Error("GitHub workflow lookup returned an invalid response");
  }

  const workflow = body as { status?: unknown; conclusion?: unknown };
  const status = normalizedState(workflow.status, "unknown");
  if (status === "completed") {
    return { kind: "completed", conclusion: normalizedState(workflow.conclusion, "unknown") };
  }
  return { kind: "pending", status };
}

export function createGitHubWorkflowReconciliationClient(
  options: {
    environment?: Readonly<Record<string, string | undefined>>;
    authFactory?: AuthFactory;
    request?: RequestFunction;
  } = {},
): GitHubWorkflowReconciliationClient {
  const environment = options.environment ?? process.env;
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/gu, "\n").trim();
  if (!appId || !privateKey) throw new Error("GitHub App workflow reconciliation is not configured");
  const apiBaseUrl = environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com";
  const authFactory = options.authFactory ?? (createAppAuth as unknown as AuthFactory);

  return {
    async readWorkflowRun(input) {
      if (!Number.isSafeInteger(input.githubInstallationId) || input.githubInstallationId <= 0) {
        throw new Error("invalid GitHub installation id");
      }
      const authenticate = authFactory({
        appId,
        privateKey,
        installationId: input.githubInstallationId,
      });
      const authentication = await authenticate({ type: "installation" });
      return readGitHubWorkflowRun({
        apiBaseUrl,
        token: authentication.token,
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        workflowRunId: input.workflowRunId,
        ...(options.request ? { request: options.request } : {}),
      });
    },
  };
}
