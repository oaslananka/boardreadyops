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
      /**
       * What a delete would take with it, per project and for the workspace as a whole.
       *
       * Carried alongside the listing rather than fetched when a dialog opens: the counts are
       * two indexed aggregates, and a confirmation that has to wait for a round trip before it
       * can tell you the blast radius is a confirmation people click through.
       */
      impact: WorkspaceProjectsImpact;
      /** Total projects in the workspace, which is more than the page shows. */
      total: number;
      page: number;
      totalPages: number;
    };

export type WorkspaceProjectsImpact = {
  workspace: { projects: number; revisions: number; deliveries: number };
  byProject: Readonly<Record<string, { revisions: number; deliveries: number }>>;
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
  requestedPage: string | string[] | undefined = undefined,
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

    const counts = await store.workspaceListingCounts(selected.id);
    const total = counts.projects;
    const totalPages = Math.max(1, Math.ceil(total / workspaceListingPageSize));
    const page = parseListingPage(requestedPage, totalPages);
    const projects = await store.listProjectsByWorkspace(selected.id, {
      limit: workspaceListingPageSize,
      offset: (page - 1) * workspaceListingPageSize,
    });

    // Only an owner can delete, so only an owner pays for the counts.
    let impact: WorkspaceProjectsImpact = { workspace: { projects: 0, revisions: 0, deliveries: 0 }, byProject: {} };
    if (selected.role === "owner") {
      const [workspaceImpact, projectImpacts] = await Promise.all([
        store.workspaceDeletionImpact(selected.id),
        Promise.all(
          projects.map(async (project) => [project.id, await store.projectDeletionImpact(project.id)] as const),
        ),
      ]);
      impact = { workspace: workspaceImpact, byProject: Object.fromEntries(projectImpacts) };
    }

    return { state: "ok", workspaces, selected, projects, impact, total, page, totalPages };
  } finally {
    await executor.close();
  }
}

/** 25 rows a page: enough that a small team never sees the control, few enough that a big one can move. */
export const workspaceListingPageSize = 25;

/** Reads a `page` search param, clamped so a hand-edited URL cannot ask for row nine million. */
export function parseListingPage(value: string | string[] | undefined, totalPages: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, Math.max(1, totalPages));
}
