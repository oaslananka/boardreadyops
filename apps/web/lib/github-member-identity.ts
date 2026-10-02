export type ResolvedGitHubMemberIdentity = {
  githubUserId: number;
  login: string;
  displayName?: string;
  avatarUrl?: string;
};

export type GitHubMemberIdentityResolution =
  | { status: "resolved"; identity: ResolvedGitHubMemberIdentity }
  | { status: "not_found" | "unsupported" | "unavailable" };

type ResolveDependencies = {
  fetch: typeof fetch;
};

const userAgent = "boardreadyops-cloud";

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Resolves the principal behind a typed GitHub login before a workspace grant is allowed.
 *
 * This is intentionally fail-closed. A rate limit or GitHub outage is not evidence that the
 * typed login belongs to the intended person, so callers must not turn an unavailable lookup
 * into an access grant.
 */
export async function resolveGitHubMemberIdentity(
  login: string,
  dependencies: ResolveDependencies = { fetch },
): Promise<GitHubMemberIdentityResolution> {
  let response: Response;
  try {
    response = await dependencies.fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": userAgent,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404) return { status: "not_found" };
  if (!response.ok) return { status: "unavailable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: "unavailable" };
  const record = body as Record<string, unknown>;
  if (record.type !== "User") return { status: "unsupported" };

  const githubUserId = positiveSafeInteger(record.id);
  const canonicalLogin = typeof record.login === "string" && record.login.length > 0 ? record.login : undefined;
  if (githubUserId === undefined || !canonicalLogin) return { status: "unavailable" };

  const displayName = typeof record.name === "string" && record.name.trim().length > 0 ? record.name.trim() : undefined;
  const avatarUrl =
    typeof record.avatar_url === "string" && /^https:\/\/avatars\.githubusercontent\.com\//u.test(record.avatar_url)
      ? record.avatar_url
      : undefined;

  return {
    status: "resolved",
    identity: {
      githubUserId,
      login: canonicalLogin,
      ...(displayName ? { displayName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  };
}
