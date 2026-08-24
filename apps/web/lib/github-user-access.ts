/**
 * Resolves what a signed-in GitHub user is allowed to see.
 *
 * The GitHub App's user-to-server flow answers exactly the question the dashboard needs: which
 * installations of *this* App can *this* user reach. That is stronger than asking whether they
 * can read the repository, because it also covers the case where the App was never installed.
 *
 * The user access token never leaves this module and is never persisted. It is exchanged, used
 * once to list installations, and discarded; only the resulting installation ids are carried in
 * the session cookie.
 */

export type GitHubOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
};

export type GitHubUserIdentity = {
  userId: number;
  login: string;
  installationIds: number[];
};

export type GitHubUserAccessDependencies = {
  fetch: typeof fetch;
};

const userAgent = "boardreadyops-cloud";
const maximumInstallationPages = 10;
const perPage = 100;

export function configuredGitHubOAuth(
  environment: Readonly<Record<string, string | undefined>>,
): GitHubOAuthConfiguration | undefined {
  const clientId = environment.GITHUB_CLIENT_ID?.trim();
  const clientSecret = environment.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

/** The URL a visitor is sent to in order to identify themselves. */
export function githubAuthorizeUrl(
  configuration: GitHubOAuthConfiguration,
  redirectUri: string,
  state: string,
): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCodeForToken(
  configuration: GitHubOAuthConfiguration,
  code: string,
  redirectUri: string,
  dependencies: GitHubUserAccessDependencies,
): Promise<string | undefined> {
  const response = await dependencies.fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) return undefined;

  const body = (await response.json()) as { access_token?: unknown; error?: unknown };
  return typeof body.access_token === "string" && body.access_token.length > 0 ? body.access_token : undefined;
}

async function fetchViewer(
  token: string,
  dependencies: GitHubUserAccessDependencies,
): Promise<{ userId: number; login: string } | undefined> {
  const response = await dependencies.fetch("https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": userAgent },
  });
  if (!response.ok) return undefined;

  const body = (await response.json()) as { id?: unknown; login?: unknown };
  if (typeof body.id !== "number" || !Number.isSafeInteger(body.id) || body.id <= 0) return undefined;
  if (typeof body.login !== "string" || body.login.length === 0) return undefined;
  return { userId: body.id, login: body.login };
}

async function fetchInstallationIds(token: string, dependencies: GitHubUserAccessDependencies): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; page <= maximumInstallationPages; page += 1) {
    const response = await dependencies.fetch(
      `https://api.github.com/user/installations?per_page=${perPage}&page=${page}`,
      {
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": userAgent },
      },
    );
    if (!response.ok) break;

    const body = (await response.json()) as { installations?: unknown };
    const installations = Array.isArray(body.installations) ? body.installations : [];
    for (const installation of installations) {
      const id = (installation as { id?: unknown })?.id;
      if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ids.push(id);
    }
    if (installations.length < perPage) break;
  }
  return [...new Set(ids)];
}

/**
 * Completes the OAuth callback and resolves the viewer's identity and reachable installations.
 *
 * Returns `undefined` whenever any step fails rather than a partial identity: a viewer whose
 * installation list could not be established must not end up with a session that silently
 * grants nothing, because that is indistinguishable from a real account with no installations.
 */
export async function resolveGitHubUserIdentity(
  configuration: GitHubOAuthConfiguration,
  code: string,
  redirectUri: string,
  dependencies: GitHubUserAccessDependencies,
): Promise<GitHubUserIdentity | undefined> {
  const token = await exchangeCodeForToken(configuration, code, redirectUri, dependencies);
  if (!token) return undefined;

  const viewer = await fetchViewer(token, dependencies);
  if (!viewer) return undefined;

  const installationIds = await fetchInstallationIds(token, dependencies);
  return { ...viewer, installationIds };
}
