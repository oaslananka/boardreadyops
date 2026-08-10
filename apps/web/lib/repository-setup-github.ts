import { repositorySetupWorkflowName, repositorySetupWorkflowPath } from "@boardreadyops/cloud-core/repository-setup";
import { createAppAuth } from "@octokit/auth-app";

type RepositorySetupGitHubReadiness = {
  actionsEnabled: boolean;
  workflowStatus: "actions_disabled" | "disabled" | "incompatible" | "missing" | "probe_required";
  workflowId?: number;
  workflowName?: string;
  workflowPath?: string;
};

export type RepositorySetupGitHubClient = {
  inspect(input: {
    githubInstallationId: number;
    owner: string;
    name: string;
  }): Promise<RepositorySetupGitHubReadiness>;
  dispatchProbe(input: {
    githubInstallationId: number;
    owner: string;
    name: string;
    defaultBranch: string;
    probeId: string;
  }): Promise<{ workflowRunId: string; workflowRunUrl?: string }>;
};

type RequestFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type InstallationAuthenticator = (input: { type: "installation" }) => Promise<{ token: string }>;
type AuthFactory = (input: { appId: string; privateKey: string; installationId: number }) => InstallationAuthenticator;

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const repositoryPattern = /^[A-Za-z0-9._-]{1,100}$/u;
const branchPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,254})$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validateTarget(owner: string, name: string): void {
  if (!ownerPattern.test(owner) || !repositoryPattern.test(name)) throw new Error("invalid GitHub repository target");
}

function headers(token: string): Readonly<Record<string, string>> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

async function responseJson(response: Response, label: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} returned an unreadable response`);
  }
  if (!response.ok || typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`${label} failed with status ${response.status}`);
  }
  return body as Record<string, unknown>;
}

function setupResultUrl(environment: Readonly<Record<string, string | undefined>>, probeId: string): string {
  const baseUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (!baseUrl || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/?$/u.test(baseUrl)) {
    throw new Error("public app URL is required for repository setup probes");
  }
  return `${baseUrl.replace(/\/$/u, "")}/api/v1/setup-probes/result?probe_id=${encodeURIComponent(probeId)}`;
}

function dummyResultUrl(environment: Readonly<Record<string, string | undefined>>, probeId: string): string {
  const baseUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) throw new Error("public app URL is required for repository setup probes");
  return `${baseUrl.replace(/\/$/u, "")}/api/v1/runs/github-actions-result?run_id=${probeId}&attempt_id=${probeId}`;
}

function repositorySetupReadinessFromWorkflow(workflow: Record<string, unknown>): RepositorySetupGitHubReadiness {
  const workflowId = typeof workflow.id === "number" && Number.isSafeInteger(workflow.id) ? workflow.id : undefined;
  const workflowName = typeof workflow.name === "string" ? workflow.name : undefined;
  const workflowPath = typeof workflow.path === "string" ? workflow.path : undefined;
  const metadata = {
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowPath ? { workflowPath } : {}),
  };

  if (workflow.state !== "active") {
    return { actionsEnabled: true, workflowStatus: "disabled", ...metadata };
  }
  if (
    workflowName !== repositorySetupWorkflowName ||
    workflowPath !== `.github/workflows/${repositorySetupWorkflowPath}`
  ) {
    return { actionsEnabled: true, workflowStatus: "incompatible", ...metadata };
  }
  return { actionsEnabled: true, workflowStatus: "probe_required", ...metadata };
}

export function createRepositorySetupGitHubClient(
  options: {
    environment?: Readonly<Record<string, string | undefined>>;
    authFactory?: AuthFactory;
    request?: RequestFunction;
  } = {},
): RepositorySetupGitHubClient {
  const environment = options.environment ?? process.env;
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
  if (!appId || !privateKey) throw new Error("GitHub App repository setup client is not configured");
  const configuredAppId = appId;
  const configuredPrivateKey = privateKey;
  const apiBaseUrl = (environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");
  const authFactory = options.authFactory ?? (createAppAuth as unknown as AuthFactory);
  const request = options.request ?? fetch;

  async function token(githubInstallationId: number): Promise<string> {
    if (!Number.isSafeInteger(githubInstallationId) || githubInstallationId <= 0) {
      throw new Error("invalid GitHub installation id");
    }
    const authenticate = authFactory({
      appId: configuredAppId,
      privateKey: configuredPrivateKey,
      installationId: githubInstallationId,
    });
    const authentication = await authenticate({ type: "installation" });
    return authentication.token;
  }

  return {
    async inspect(input) {
      validateTarget(input.owner, input.name);
      const installationToken = await token(input.githubInstallationId);
      const target = `${apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`;
      const workflowResponse = await request(
        `${target}/actions/workflows/${encodeURIComponent(repositorySetupWorkflowPath)}`,
        { method: "GET", headers: headers(installationToken) },
      );
      if (workflowResponse.status === 403) return { actionsEnabled: false, workflowStatus: "actions_disabled" };
      if (workflowResponse.status === 404) return { actionsEnabled: true, workflowStatus: "missing" };
      const workflow = await responseJson(workflowResponse, "GitHub Actions workflow lookup");
      return repositorySetupReadinessFromWorkflow(workflow);
    },

    async dispatchProbe(input) {
      validateTarget(input.owner, input.name);
      if (!branchPattern.test(input.defaultBranch) || input.defaultBranch.includes("..")) {
        throw new Error("invalid repository default branch");
      }
      if (!uuidPattern.test(input.probeId)) throw new Error("invalid repository setup probe id");
      const installationToken = await token(input.githubInstallationId);
      const endpoint = `${apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(
        input.name,
      )}/actions/workflows/${encodeURIComponent(repositorySetupWorkflowPath)}/dispatches`;
      let response: Response;
      try {
        response = await request(endpoint, {
          method: "POST",
          headers: headers(installationToken),
          body: JSON.stringify({
            ref: input.defaultBranch,
            inputs: {
              run_id: input.probeId,
              execution_attempt_id: input.probeId,
              target: `${input.owner}/${input.name}`,
              head_sha: "0".repeat(40),
              result_url: dummyResultUrl(environment, input.probeId),
              safe_mode: "false",
              safe_mode_reasons: "",
              setup_probe_id: input.probeId,
              setup_result_url: setupResultUrl(environment, input.probeId),
            },
            return_run_details: true,
          }),
        });
      } catch (error) {
        throw new Error("repository setup probe dispatch failed before GitHub returned a response", { cause: error });
      }
      const body = await responseJson(response, "repository setup probe dispatch");
      const workflowRunId =
        typeof body.workflow_run_id === "number" && Number.isSafeInteger(body.workflow_run_id)
          ? String(body.workflow_run_id)
          : undefined;
      if (!workflowRunId) throw new Error("repository setup probe dispatch did not return a workflow run id");
      const workflowRunUrl =
        typeof body.html_url === "string" ? body.html_url : typeof body.run_url === "string" ? body.run_url : undefined;
      return { workflowRunId, ...(workflowRunUrl ? { workflowRunUrl } : {}) };
    },
  };
}
