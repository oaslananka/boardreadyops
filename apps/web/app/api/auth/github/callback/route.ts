import { configuredGitHubOAuth, resolveGitHubUserIdentity } from "../../../../../lib/github-user-access.js";
import { oauthStateCookieName, parseOAuthStateCookie, stateMatches } from "../../../../../lib/oauth-state.js";
import { configuredSessionSecret, encodeUserSession } from "../../../../../lib/user-session.js";
import { sessionCookieName, sessionLifetimeMs } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

const clearedState = `${oauthStateCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function failed(reason: string): Response {
  // The state cookie is cleared on every outcome so a failed attempt cannot be replayed.
  return new Response(null, {
    status: 302,
    headers: new Headers([
      ["location", `/?sign_in=${reason}`],
      ["set-cookie", clearedState],
    ]),
  });
}

export async function GET(request: Request): Promise<Response> {
  const configuration = configuredGitHubOAuth(process.env);
  const secret = configuredSessionSecret(process.env);
  const publicUrl = process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!configuration || !secret || !publicUrl) return failed("unavailable");

  const parameters = new URL(request.url).searchParams;
  const stored = parseOAuthStateCookie(readCookie(request, oauthStateCookieName));
  if (!stored || !stateMatches(stored.state, parameters.get("state"))) return failed("expired");

  const code = parameters.get("code");
  if (!code) return failed("denied");

  const redirectUri = new URL("/api/auth/github/callback", publicUrl).toString();
  const identity = await resolveGitHubUserIdentity(configuration, code, redirectUri, { fetch });
  if (!identity) return failed("denied");

  const issuedAt = new Date();
  const token = encodeUserSession(
    {
      userId: identity.userId,
      login: identity.login,
      installationIds: identity.installationIds,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + sessionLifetimeMs).toISOString(),
    },
    secret,
  );

  return new Response(null, {
    status: 302,
    headers: new Headers([
      ["location", stored.returnTo],
      [
        "set-cookie",
        `${sessionCookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`,
      ],
      ["set-cookie", clearedState],
    ]),
  });
}
