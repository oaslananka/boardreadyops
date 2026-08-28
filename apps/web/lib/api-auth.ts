import { type ApiTokenScope, ApiTokenStore } from "@boardreadyops/db";
import { createPgQueryExecutor, type PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import { viewerAuthorization } from "./viewer-authorization.js";

export interface AuthenticatedApiContext {
  ok: true;
  repositoryId?: string;
  actorId: string;
  scopes: ApiTokenScope[];
  authType: "bearer_token" | "session";
  installationIds?: number[];
}

export interface ApiAuthError {
  ok: false;
  error: string;
  status: number;
}

export async function authenticateApiRequest(
  request: Request,
  requiredScope?: ApiTokenScope,
): Promise<AuthenticatedApiContext | ApiAuthError> {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const rawToken = authHeader.slice("Bearer ".length).trim();
    try {
      const config = resolveCloudPersistenceConfiguration();
      if (config.mode !== "postgres") {
        return { ok: false, error: "Database not configured", status: 503 };
      }

      const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
      try {
        const store = new ApiTokenStore(executor);
        const tokenRecord = await store.validateToken(rawToken);
        if (!tokenRecord) {
          return { ok: false, error: "Invalid or expired API token", status: 401 };
        }

        if (requiredScope && !tokenRecord.scopes.includes(requiredScope) && !tokenRecord.scopes.includes("admin")) {
          return { ok: false, error: `Missing required scope: ${requiredScope}`, status: 403 };
        }

        return {
          ok: true,
          repositoryId: tokenRecord.repositoryId,
          actorId: tokenRecord.id,
          scopes: tokenRecord.scopes,
          authType: "bearer_token",
        };
      } finally {
        await executor.close();
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Authentication error", status: 500 };
    }
  }

  const viewer = await viewerAuthorization();
  if (viewer.session) {
    return {
      ok: true,
      actorId: viewer.session.login,
      scopes: ["runs:write", "reviews:read", "reviews:write", "admin"],
      authType: "session",
      installationIds: [...viewer.session.installationIds],
    };
  }

  return { ok: false, error: "Authentication required", status: 401 };
}

export interface RepositoryApiContext {
  repositoryId: string;
  executor: PgQueryExecutor;
}

function safeInstallationId(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function resolveRepositoryApiContext(
  auth: AuthenticatedApiContext,
  request: Request,
  explicitRepositoryId?: string,
): Promise<RepositoryApiContext | Response> {
  const url = new URL(request.url);
  const queryRepositoryId = url.searchParams.get("repositoryId") ?? undefined;

  if (auth.repositoryId && explicitRepositoryId && auth.repositoryId !== explicitRepositoryId) {
    return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
  }
  if (auth.repositoryId && queryRepositoryId && auth.repositoryId !== queryRepositoryId) {
    return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
  }

  const repositoryId = explicitRepositoryId ?? auth.repositoryId ?? queryRepositoryId;
  if (!repositoryId) {
    return Response.json({ ok: false, error: "repositoryId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const result = await executor.query(
      `select installations.github_installation_id
         from repositories
         join installations on installations.id = repositories.installation_id
        where repositories.id = $1
          and repositories.disabled_at is null
          and installations.suspended_at is null
          and not exists (
            select 1
              from github_marketplace_subscriptions
             where github_marketplace_subscriptions.status = 'canceled'
               and (
                 github_marketplace_subscriptions.github_installation_id = installations.github_installation_id
                 or (
                   github_marketplace_subscriptions.github_installation_id is null
                   and lower(github_marketplace_subscriptions.account_login) = lower(installations.account_login)
                 )
               )
          )
        limit 1`,
      [repositoryId],
    );
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const githubInstallationId = safeInstallationId(rows[0]?.github_installation_id);
    if (githubInstallationId === undefined) {
      await executor.close();
      return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
    }

    if (auth.authType === "session" && !auth.installationIds?.includes(githubInstallationId)) {
      await executor.close();
      return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
    }

    return { repositoryId, executor };
  } catch (error) {
    await executor.close();
    throw error;
  }
}
