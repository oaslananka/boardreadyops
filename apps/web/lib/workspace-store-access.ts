import type { WorkspaceStore } from "@boardreadyops/db";

/**
 * Opens a `WorkspaceStore` and its executor together.
 *
 * The import is dynamic so the database driver stays out of any bundle that only needs the types,
 * and `max: 1` because every caller is one request's worth of work rather than a pool's.
 *
 * Shared because three call sites had written it identically -- and a fourth would have. The
 * caller still owns closing the executor, which is why both come back: a helper that closed it
 * for them could not return rows they are still reading.
 */
export async function openWorkspaceStore(
  connectionString: string,
): Promise<{ store: WorkspaceStore; executor: { close(): Promise<void> } }> {
  const [{ WorkspaceStore: Store }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  return { store: new Store(executor), executor };
}
