import { createAppAuth } from "@octokit/auth-app";
import type { CheckLiveRepositoryPermission } from "./remote-mcp-access.js";

type GithubResponse = Record<string, unknown>;
type GithubFetch = typeof fetch;

const githubLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const maxResponseBytes = 64 * 1024;
const requestTimeoutMs = 5_000;

/** GitHub.com is the only provider for hosted Reviews. Installation tokens
 * must never be sent to arbitrary HTTPS origins or caller-configured paths.
 * Future GitHub Enterprise support requires a separate audited trust policy.
 */
function strictGithubApiRoot(environment: Readonly<Record<string, string | undefined>>): string | null {
  const input = environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com";
  return input === "https://api.github.com" || input === "https://api.github.com/" ? "https://api.github.com" : null;
}

/** Enforce the response size while receiving chunks, before allocating an
 * unbounded string. Content-Length is only a hint and may be absent or wrong.
 * Cancel the remaining body on oversize, even if the server is still streaming.
 */
async function readBoundedGithubJson(response: Response): Promise<GithubResponse | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return null;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const raw = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) {
      raw.set(chunk, position);
      position += chunk.byteLength;
    }
    const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    return result && typeof result === "object" && !Array.isArray(result) ? (result as GithubResponse) : null;
  } finally {
    reader.releaseLock();
  }
}

/** All installation-token reads use the same bounded, no-redirect request contract. */
function githubGet(apiRoot: string, token: string, resource: string, fetcher: GithubFetch): Promise<Response> {
  return fetcher(`${apiRoot}${resource}`, {
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
}

/** Require explicit collaborator/team/organization membership, not public readability. */
async function githubIsCollaborator(
  apiRoot: string,
  token: string,
  resource: string,
  fetcher: GithubFetch,
): Promise<boolean> {
  const response = await githubGet(apiRoot, token, resource, fetcher);
  // GitHub returns HTTP 204 for a genuine collaborator and HTTP 404 for an
  // outsider. Public repositories can misleadingly report "permission: read"
  // for unrelated accounts, so only HTTP 204 from this endpoint is accepted.
  await response.body?.cancel().catch(() => undefined);
  return response.status === 204;
}

/** Restricted JSON decoder: no redirects, no partial responses, no oversized API payloads. */
async function githubJson(
  apiRoot: string,
  token: string,
  resource: string,
  fetcher: GithubFetch,
): Promise<GithubResponse | null> {
  const response = await githubGet(apiRoot, token, resource, fetcher);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  return readBoundedGithubJson(response);
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
 * require real collaborator membership and the calculated permission on every
 * call. Public repository visibility by itself is NEVER Review data authority.
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
      const collaboratorPath = `${repositoryPath}/collaborators/${encodeURIComponent(String(user.login))}`;
      if (!(await githubIsCollaborator(deps.apiRoot, token, collaboratorPath, deps.fetcher))) return false;
      const permission = await githubJson(deps.apiRoot, token, `${collaboratorPath}/permission`, deps.fetcher);
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

/** The production default signs a short-lived installation grant with Octokit.
 * The injectable function is used by fixture-based acceptance tests only.
 */
export type MintMcpGitHubInstallationToken = (
  appId: string,
  privateKey: string,
  installationId: number,
) => Promise<string | null>;

const mintGitHubAppInstallationToken: MintMcpGitHubInstallationToken = async (appId, privateKey, installationId) => {
  const authenticate = createAppAuth({ appId, privateKey, installationId });
  const result = await authenticate({ type: "installation" });
  return result.token || null;
};

/** Uses existing GitHub App configuration, with no new secret or authentication service. */
export function createProductionLiveGitHubRepositoryAccess(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: GithubFetch = fetch,
  mintInstallationToken: MintMcpGitHubInstallationToken = mintGitHubAppInstallationToken,
): CheckLiveRepositoryPermission {
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
  const apiRoot = strictGithubApiRoot(environment);
  if (!appId || !privateKey || !apiRoot) return async () => false;
  return createLiveGitHubRepositoryAccess({
    apiRoot,
    fetcher,
    createInstallationToken: (installationId) => mintInstallationToken(appId, privateKey, installationId),
  });
}
