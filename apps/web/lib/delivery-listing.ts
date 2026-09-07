import type { WorkspaceDeliveryRecord, WorkspaceMembershipRecord, WorkspaceRevisionRecord } from "@boardreadyops/db";
import { reviewFixturesEnabled } from "./review-listing.js";
import type { UserSession } from "./user-session.js";

/**
 * Guest delivery links for the workspace the viewer is looking at.
 *
 * A delivery is a public URL: anyone holding it reads the signed archive at `/deliveries/[token]`
 * with no account. That makes the owner-side view the only place the set of live links is
 * visible, and until now there was no such place -- `createDeliveryLink` existed, the guest page
 * existed, and nothing listed what had been handed out.
 *
 * Scoped the same way `/projects` is: through `workspace_members`, keyed by GitHub login. The
 * workspace id is never taken on trust; an id the viewer is not a member of falls back to one
 * they are.
 */

export type DeliveryListingResult =
  | { state: "signed-out" }
  | { state: "not-configured" }
  | { state: "no-workspaces" }
  | {
      state: "ok";
      workspaces: readonly WorkspaceMembershipRecord[];
      selected: WorkspaceMembershipRecord;
      deliveries: readonly WorkspaceDeliveryRecord[];
      /**
       * Revisions a link can be minted against. Empty is a real and common state: a revision only
       * exists once a package has been uploaded, and that upload is API-only today.
       */
      revisions: readonly WorkspaceRevisionRecord[];
    };

async function openStore(connectionString: string) {
  const [{ WorkspaceStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  return { store: new WorkspaceStore(executor), executor };
}

export async function loadWorkspaceDeliveries(
  session: UserSession | undefined,
  requestedWorkspaceId: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DeliveryListingResult> {
  if (reviewFixturesEnabled(environment)) return { state: "not-configured" };
  if (!session) return { state: "signed-out" };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const { store, executor } = await openStore(connectionString);
  try {
    const workspaces = await store.listWorkspacesForUser(session.login);
    if (workspaces.length === 0) return { state: "no-workspaces" };

    const selected = workspaces.find((workspace) => workspace.id === requestedWorkspaceId) ?? workspaces[0];
    if (!selected) return { state: "no-workspaces" };

    const [deliveries, revisions] = await Promise.all([
      store.listDeliveriesByWorkspace(selected.id),
      store.listRevisionsByWorkspace(selected.id),
    ]);
    return { state: "ok", workspaces, selected, deliveries, revisions };
  } finally {
    await executor.close();
  }
}

/** Whether a delivery's window has closed. The guest page enforces this; the list states it. */
export function deliveryExpired(delivery: { expiresAt: string }, now: Date = new Date()): boolean {
  const expires = Date.parse(delivery.expiresAt);
  return Number.isNaN(expires) ? false : expires <= now.getTime();
}
