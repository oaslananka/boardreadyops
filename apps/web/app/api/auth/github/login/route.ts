import { randomBytes } from "node:crypto";
import { configuredGitHubOAuth, githubAuthorizeUrl } from "../../../../../lib/github-user-access.js";
import { oauthStateCookieName, safeReturnPath } from "../../../../../lib/oauth-state.js";

export const runtime = "nodejs";

/**
 * Starts GitHub sign-in.
 *
 * The `state` value is minted here, stored in a short-lived cookie, and compared on callback so
 * a forged callback cannot complete somebody else's sign-in.
 */
export async function GET(request: Request): Promise<Response> {
  const configuration = configuredGitHubOAuth(process.env);
  if (!configuration) {
    return Response.json({ ok: false, error: "sign-in is not configured" }, { status: 503 });
  }

  const publicUrl = process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!publicUrl) {
    return Response.json({ ok: false, error: "sign-in is not configured" }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return_to"));
  const redirectUri = new URL("/api/auth/github/callback", publicUrl).toString();

  const response = Response.redirect(githubAuthorizeUrl(configuration, redirectUri, state), 302);
  const headers = new Headers(response.headers);
  headers.append(
    "set-cookie",
    `${oauthStateCookieName}=${state}.${encodeURIComponent(returnTo)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return new Response(null, { status: 302, headers });
}
