import type { WorkspaceMemberRecord, WorkspaceMembershipRecord } from "@boardreadyops/db";
import { reviewFixturesEnabled } from "./review-listing.js";
import type { UserSession } from "./user-session.js";
import { openWorkspaceStore } from "./workspace-store-access.js";

/**
 * Who can reach a workspace, and with what role.
 *
 * `workspace_members` is what every v2 surface authorizes against, and until now the only row it
 * ever held was the one `createWorkspace` writes for the creator. A workspace could not gain a
 * second person, which made "workspace" a misleading word for what was a single-user container.
 */

export type WorkspaceMembersResult =
  | { state: "signed-out" }
  | { state: "not-configured" }
  | { state: "no-workspaces" }
  | {
      state: "ok";
      workspaces: readonly WorkspaceMembershipRecord[];
      selected: WorkspaceMembershipRecord;
      members: readonly WorkspaceMemberRecord[];
    };

export async function loadWorkspaceMembers(
  session: UserSession | undefined,
  requestedWorkspaceId: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceMembersResult> {
  if (reviewFixturesEnabled(environment)) return { state: "not-configured" };
  if (!session) return { state: "signed-out" };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const workspaces = await store.listWorkspacesForUser(session.login);
    if (workspaces.length === 0) return { state: "no-workspaces" };

    const selected = workspaces.find((workspace) => workspace.id === requestedWorkspaceId) ?? workspaces[0];
    if (!selected) return { state: "no-workspaces" };

    const members = await store.listWorkspaceMembers(selected.id);
    return { state: "ok", workspaces, selected, members };
  } finally {
    await executor.close();
  }
}

/** Owners and admins manage members; everyone else sees the list read-only. */
export function canManageMembers(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Whether removing this member would leave the workspace with no owner.
 *
 * The store refuses it in the same statement that deletes, so this is only for hiding a control
 * that would fail -- never the thing preventing it.
 */
export function isLastOwner(members: readonly WorkspaceMemberRecord[], userId: string): boolean {
  const owners = members.filter((member) => member.role === "owner");
  return owners.length === 1 && owners[0]?.userId === userId;
}
