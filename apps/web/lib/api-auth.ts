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

  // 1. Check Bearer Token
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

  // 2. Check User Session
  const viewer = await viewerAuthorization();
  if (viewer.session) {
    return {
      ok: true,
      actorId: viewer.session.login,
      scopes: ["runs:write", "reviews:read", "reviews:write", "admin"],
      authType: "session",
    };
  }

  return { ok: false, error: "Authentication required", status: 401 };
}

export interface RepositoryApiContext {
  auth: AuthenticatedApiContext;
  repositoryId: string;
  executor: PgQueryExecutor;
}

/**
 * Authenticates a request, resolves its repositoryId (from the token or the ?repositoryId
 * query param), and opens a Postgres executor - the common prelude shared by every
 * repository-scoped API route. Callers own the returned executor and must close it.
 */
export async function requireRepositoryApiContext(
  request: Request,
  requiredScope?: ApiTokenScope,
): Promise<RepositoryApiContext | Response> {
  const auth = await authenticateApiRequest(request, requiredScope);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");
  if (!repositoryId) {
    return Response.json({ ok: false, error: "repositoryId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  return { auth, repositoryId, executor };
}
