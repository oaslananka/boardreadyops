import {
  issueProtectedIntentCsrfToken,
  parseProtectedIntentJson,
  protectedIntentSecret,
  validProtectedIntentCsrfToken,
  validProtectedIntentOrigin,
} from "./protected-release-intent-request.js";
import type { UserSession } from "./user-session.js";

type Viewer = { session: UserSession | undefined };
type Recorder = (input: {
  session: UserSession;
  repositoryId: string;
  sha: string;
  requestId: string;
}) => Promise<{ id: string; inserted: boolean } | undefined>;

/**
 * Evidence-only HTTP operation: records the signed viewer's explicit intent.
 * It DOES NOT create a run, dispatch a workflow, issue a lease or grant OIDC.
 * Only a real GitHub repository administrator can produce an accepted record:
 * the recorder checks GitHub identity and branch rules before the SQL write.
 */
export type ProtectedIntentRouteDependencies = {
  environment?: Readonly<Record<string, string | undefined>>;
  viewer?: () => Promise<Viewer>;
  record?: Recorder;
  now?: () => Date;
};

function reply(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function actualRecord(input: Parameters<Recorder>[0]): ReturnType<Recorder> {
  const { createPgQueryExecutor } = await import("@boardreadyops/db/pg-executor");
  const { createAppAuth } = await import("@octokit/auth-app");
  const { recordProtectedReleaseIntentForViewer } = await import("./protected-release-intent-recorder.js");
  const environment = process.env;
  const dbUrl = environment.DATABASE_URL;
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
  if (!dbUrl || !appId || !privateKey) throw new Error("Protected intent recording unavailable.");
  const executor = createPgQueryExecutor({ connectionString: dbUrl, max: 1 });
  try {
    return await recordProtectedReleaseIntentForViewer(input, {
      db: executor,
      now: () => new Date(),
      async installationToken(installationId) {
        const app = createAppAuth({ appId, privateKey, installationId });
        const result = await app({ type: "installation" });
        return result.token;
      },
    });
  } finally {
    await executor.close();
  }
}

function validSessionForIntent(session: UserSession | undefined, now: Date): session is UserSession {
  if (!session || !Number.isSafeInteger(session.userId) || session.userId <= 0) return false;
  const issued = Date.parse(session.issuedAt);
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) && issued <= now.getTime() && expires > now.getTime();
}

export async function handleProtectedReleaseIntent(
  request: Request,
  repositoryId: string,
  dependencies: ProtectedIntentRouteDependencies = {},
): Promise<Response> {
  const environment = dependencies.environment ?? process.env;
  const now = (dependencies.now ?? (() => new Date()))();
  const secret = protectedIntentSecret(environment);

  // API bearer tokens and generic dashboard "admin" scopes never authorize
  // protected branch release intent, even when a cookie is also present.
  if (request.headers.has("authorization")) return reply(401, { error: "Signed GitHub session required" });
  if (!secret || !Number.isFinite(now.getTime()) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(repositoryId)) {
    return reply(503, { error: "Protected intent unavailable" });
  }

  // Import dynamically: Next's cookies() may only be called inside a request.
  const viewer = dependencies.viewer ?? (await import("./viewer-authorization.js")).viewerAuthorization;
  const { session } = await viewer();
  if (!validSessionForIntent(session, now)) {
    return reply(401, { error: "Signed GitHub session required" });
  }

  if (request.method === "GET") {
    return reply(200, { csrfToken: issueProtectedIntentCsrfToken(session, repositoryId, secret, now) });
  }
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });
  if (!validProtectedIntentOrigin(request, environment)) return reply(403, { error: "Invalid origin" });
  if (!validProtectedIntentCsrfToken(request.headers.get("x-boardreadyops-csrf"), session, repositoryId, secret, now))
    return reply(403, { error: "Invalid CSRF token" });

  const payload = await parseProtectedIntentJson(request);
  if (!payload) return reply(400, { error: "Invalid protected intent" });

  try {
    const recorded = await (dependencies.record ?? actualRecord)({ session, repositoryId, ...payload });
    if (!recorded) return reply(403, { error: "Protected intent not permitted" });
    return reply(200, { candidateId: recorded.id, inserted: recorded.inserted, dispatchAllowed: false });
  } catch {
    // No installation secrets, database details, or GitHub access metadata leak.
    return reply(503, { error: "Protected intent verification unavailable" });
  }
}
