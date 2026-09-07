import type { ProjectRecord, WorkspaceMembershipRecord } from "@boardreadyops/db";
import { reviewFixturesEnabled } from "./review-listing.js";
import type { UserSession } from "./user-session.js";
import { openWorkspaceStore } from "./workspace-store-access.js";

/**
 * Workspaces the viewer belongs to, and the projects inside whichever one they are looking at.
 *
 * The v2 workspace tree has its own tenancy axis -- `workspace_members`, keyed by GitHub login --
 * separate from the `installations.github_installation_id` scope every v1 surface uses. A
 * workspace is not derived from a GitHub App installation: it is a standalone container for
 * multi-CAD work that may have no repository at all.
 *
 * Membership is the only thing that grants access, so this module never takes a workspace id on
 * trust. `loadWorkspaceProjects` re-reads the caller's role before it lists anything; a
 * workspace the viewer is not in is reported as missing rather than forbidden, so a guessed id
 * cannot be used to discover which ids exist.
 */

export type WorkspaceProjectsResult =
  | { state: "signed-out" }
  | { state: "not-configured" }
  /** Signed in, database present, but the viewer belongs to no workspace yet. */
  | { state: "no-workspaces" }
  | {
      state: "ok";
      workspaces: readonly WorkspaceMembershipRecord[];
      selected: WorkspaceMembershipRecord;
      projects: readonly ProjectRecord[];
    };

/**
 * Every workspace the viewer is a member of, newest first.
 *
 * Exported separately because the create-project action needs the same answer without paying for
 * a project listing it will not use.
 */
export async function loadViewerWorkspaces(
  session: UserSession | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<readonly WorkspaceMembershipRecord[]> {
  if (!session) return [];
  const connectionString = environment.DATABASE_URL;
  if (!connectionString || reviewFixturesEnabled(environment)) return [];

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    return await store.listWorkspacesForUser(session.login);
  } finally {
    await executor.close();
  }
}

export async function loadWorkspaceProjects(
  session: UserSession | undefined,
  requestedWorkspaceId: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceProjectsResult> {
  if (reviewFixturesEnabled(environment)) return { state: "not-configured" };
  if (!session) return { state: "signed-out" };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const workspaces = await store.listWorkspacesForUser(session.login);
    if (workspaces.length === 0) return { state: "no-workspaces" };

    // An unknown or unreachable id falls back to the first workspace rather than erroring: the
    // id usually comes from a stale bookmark or a workspace someone was removed from, and
    // showing them a workspace they *can* see is more useful than an error page. It cannot leak
    // anything, because the fallback is chosen from their own memberships.
    const selected = workspaces.find((workspace) => workspace.id === requestedWorkspaceId) ?? workspaces[0];
    if (!selected) return { state: "no-workspaces" };

    const projects = await store.listProjectsByWorkspace(selected.id);
    return { state: "ok", workspaces, selected, projects };
  } finally {
    await executor.close();
  }
}
