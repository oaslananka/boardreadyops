import type { WorkspaceRole, WorkspaceStore } from "@boardreadyops/db";
import type { AuthenticatedApiContext } from "./api-auth.js";

/**
 * Authorizes a caller against a workspace.
 *
 * The v1 API scopes every request through `installations.github_installation_id`. The v2
 * workspace tree had no equivalent: `authenticateApiRequest` proves *who* is calling, never *what
 * they may reach*, and the routes went straight from that to the store. Any authenticated caller
 * could read and write any workspace, and mint a public guest delivery link against any tenant's
 * revision. `workspace_members` (migration 0064) is the missing fact, and this is the single
 * place that reads it.
 *
 * Failures are `not-found` rather than `forbidden` so the API does not confirm that a workspace
 * id exists to someone who cannot see it.
 */
export type WorkspaceAuthorization =
  | { ok: true; userId: string; role: WorkspaceRole }
  | { ok: false; status: 403 | 404; error: string };

/**
 * The workspace identity behind a request, or `undefined` when the credential has none.
 *
 * A session is a GitHub user, so its login is the membership key. A bearer token is bound to a
 * repository and carries no user, so there is nothing to match against `workspace_members` —
 * granting it access would restore exactly the hole this module closes. Binding tokens to a
 * workspace is a product decision, not something to infer here.
 */
export function workspaceUserIdFor(auth: AuthenticatedApiContext): string | undefined {
  return auth.authType === "session" ? auth.actorId : undefined;
}

const bearerTokenNotSupported =
  "API tokens are scoped to a repository and cannot access workspaces. Use a signed-in session.";

export async function authorizeWorkspace(
  auth: AuthenticatedApiContext,
  store: WorkspaceStore,
  workspaceId: string | null,
): Promise<WorkspaceAuthorization> {
  const userId = workspaceUserIdFor(auth);
  if (!userId) return { ok: false, status: 403, error: bearerTokenNotSupported };
  if (!workspaceId) return { ok: false, status: 404, error: "Workspace not found" };

  const role = await store.workspaceRoleFor(workspaceId, userId);
  if (!role) return { ok: false, status: 404, error: "Workspace not found" };
  return { ok: true, userId, role };
}

/** Roles allowed to change a workspace's contents. `viewer` may read but not write. */
export function canWriteWorkspace(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}
