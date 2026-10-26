import { createAppAuth } from "@octokit/auth-app";
import type { CheckLiveRepositoryPermission } from "./remote-mcp-access.js";

type GithubResponse = Record<string, unknown>;
type GithubFetch = typeof fetch;

const githubLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const maxResponseBytes = 64 * 1024;
const requestTimeoutMs = 5_000;

function strictGithubApiRoot(environment: Readonly<Record<string, string | undefined>>): string | null {
  const input = environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com";
  try {
    const parsed = new URL(input);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.toString() !== input && parsed.toString() !== `${input}/`)
    )
      return null;
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

/** Restricted JSON decoder: no redirects, no partial responses, no oversized API payloads. */
async function githubJson(
  apiRoot: string,
  token: string,
  resource: string,
  fetcher: GithubFetch,
): Promise<GithubResponse | null> {
  const response = await fetcher(`${apiRoot}${resource}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxResponseBytes) return null;
  const body = await response.text();
  if (body.length > maxResponseBytes) return null;
  const result: unknown = JSON.parse(body);
  return result && typeof result === "object" && !Array.isArray(result) ? (result as GithubResponse) : null;
}

export interface LiveGitHubPermissionDependencies {
  createInstallationToken(installationId: number): Promise<string | null>;
  fetcher: GithubFetch;
  apiRoot: string;
}

/**
 * Live GitHub user→repository access, resolved by immutable user and repository ids.
 * The installation token authenticates the GitHub App only; it is NOT evidence of
 * the user's permission. We validate the user and repo identities separately and
 * read the user's calculated collaborator permission on every call.
 */
export function createLiveGitHubRepositoryAccess(
  deps: LiveGitHubPermissionDependencies,
): CheckLiveRepositoryPermission {
  return async ({ githubUserId, githubRepositoryId, githubInstallationId, owner, name }) => {
    if (
      !Number.isSafeInteger(githubUserId) ||
      githubUserId <= 0 ||
      !Number.isSafeInteger(githubRepositoryId) ||
      githubRepositoryId <= 0 ||
      !Number.isSafeInteger(githubInstallationId) ||
      githubInstallationId <= 0 ||
      !githubLoginPattern.test(owner) ||
      name === "." ||
      name === ".." ||
      !/^[A-Za-z0-9_.-]{1,100}$/u.test(name)
    )
      return false;
    try {
      const token = await deps.createInstallationToken(githubInstallationId);
      if (!token) return false;
      const user = await githubJson(deps.apiRoot, token, `/user/${githubUserId}`, deps.fetcher);
      if (!user || Number(user.id) !== githubUserId || !githubLoginPattern.test(String(user.login ?? ""))) return false;
      const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      const repository = await githubJson(deps.apiRoot, token, repositoryPath, deps.fetcher);
      if (Number(repository?.id) !== githubRepositoryId) return false;
      const permission = await githubJson(
        deps.apiRoot,
        token,
        `${repositoryPath}/collaborators/${encodeURIComponent(String(user.login))}/permission`,
        deps.fetcher,
      );
      return (
        permission?.permission === "read" ||
        permission?.permission === "write" ||
        permission?.permission === "admin" ||
        permission?.permission === "triage" ||
        permission?.permission === "maintain"
      );
    } catch {
      // Network errors, rate limits, revocation, bad payloads and API outages deny access.
      return false;
    }
  };
}

/** Uses existing GitHub App configuration, with no new secret or authentication service. */
export function createProductionLiveGitHubRepositoryAccess(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: GithubFetch = fetch,
): CheckLiveRepositoryPermission {
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\\n`, "\n").trim();
  const apiRoot = strictGithubApiRoot(environment);
  if (!appId || !privateKey || !apiRoot) return async () => false;
  return createLiveGitHubRepositoryAccess({
    apiRoot,
    fetcher,
    async createInstallationToken(installationId) {
      const authenticate = createAppAuth({ appId, privateKey, installationId });
      const result = await authenticate({ type: "installation" });
      return result.token || null;
    },
  });
}
