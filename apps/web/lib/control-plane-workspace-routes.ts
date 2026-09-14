import type { WorkspaceStore } from "@boardreadyops/db";
import { authenticateControlPlaneOperator } from "./control-plane-operator-auth.js";
import { controlPlaneJsonError, controlPlaneJsonResponse } from "./control-plane-operator-response.js";
import { openWorkspaceStore } from "./workspace-store-access.js";

/**
 * Operator lookup for the workspace slug namespace.
 *
 * Answers a question that was previously unanswerable from anywhere. Someone is told "another
 * workspace already uses that slug" on a page whose heading is "Create your first workspace".
 * Both statements are true: slugs are a single global namespace because they appear in workspace
 * URLs, while the page lists only the workspaces you belong to. So the conflict is normally with
 * a workspace the person cannot see -- and until now nobody could say which, because the operator
 * surface was scoped entirely to installations and workspaces had no surface at all.
 *
 * Deliberately narrow. It resolves one slug at a time and never lists the namespace: an endpoint
 * that enumerates every workspace and its owners is a different thing carrying a different risk,
 * and diagnosing a collision does not need it.
 */

/** The slug grammar the creation form enforces: lowercase letters, digits and hyphens. */
const slugPattern = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/u;

type SlugLookup = Pick<WorkspaceStore, "findWorkspaceBySlugWithOwners">;

export type ControlPlaneWorkspaceRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  /** Injected so the handler is testable without a database, and shared with every other caller. */
  openStore: (connectionString: string) => Promise<{ store: SlugLookup; executor: { close(): Promise<void> } }>;
};

export function createControlPlaneWorkspaceRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ControlPlaneWorkspaceRouteDependencies {
  return { environment, openStore: openWorkspaceStore };
}

function authenticated(request: Request, dependencies: ControlPlaneWorkspaceRouteDependencies): Response | true {
  const authentication = authenticateControlPlaneOperator(request, dependencies.environment);
  if (authentication.status === "disabled") return controlPlaneJsonError("operator API is not configured", 503);
  if (authentication.status === "rate_limited") {
    return controlPlaneJsonError(
      `Too many failed authentication attempts, retry after ${authentication.retryAfterSeconds}s`,
      429,
      { "retry-after": String(authentication.retryAfterSeconds) },
    );
  }
  if (authentication.status === "unauthorized") {
    return controlPlaneJsonError("operator authentication is required", 401, { "www-authenticate": "Bearer" });
  }
  return true;
}

export async function handleControlPlaneWorkspaceSlugRequest(
  request: Request,
  dependencies: ControlPlaneWorkspaceRouteDependencies = createControlPlaneWorkspaceRouteDependencies(),
): Promise<Response> {
  const authentication = authenticated(request, dependencies);
  if (authentication instanceof Response) return authentication;

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return controlPlaneJsonError("slug is required", 400);
  if (!slugPattern.test(slug)) return controlPlaneJsonError("slug is invalid", 400);

  const connectionString = dependencies.environment.DATABASE_URL;
  if (!connectionString) return controlPlaneJsonError("database is not configured", 503);

  const { store, executor } = await dependencies.openStore(connectionString);
  try {
    const found = await store.findWorkspaceBySlugWithOwners(slug);
    // "Taken" and "free" are both useful answers, so neither is an error. A 404 here would make
    // the free case look like a fault and send the reader looking for one.
    if (!found) return controlPlaneJsonResponse({ ok: true, slug, taken: false }, 200);
    return controlPlaneJsonResponse(
      {
        ok: true,
        slug,
        taken: true,
        workspace: {
          id: found.workspace.id,
          name: found.workspace.name,
          planTier: found.workspace.planTier,
          createdAt: found.workspace.createdAt,
        },
        owners: found.owners,
      },
      200,
    );
  } catch {
    return controlPlaneJsonError("workspace lookup is temporarily unavailable", 503);
  } finally {
    // `openWorkspaceStore` hands the executor back precisely because closing it is the caller's
    // job; the response body is already serialised by the time this runs.
    await executor.close();
  }
}
