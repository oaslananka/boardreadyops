import { createNoopGitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";
import { createSqlGitHubAppLifecycleStore } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";

let cachedStore;

export function getGitHubAppLifecycleStore() {
  if (cachedStore) {
    return cachedStore;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    const store = createNoopGitHubAppLifecycleStore();
    cachedStore = store;
    return store;
  }

  const store = createSqlGitHubAppLifecycleStore(
    createPgQueryExecutor({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    }),
  );

  cachedStore = store;
  return store;
}

export function resetGitHubAppLifecycleStoreForTests() {
  cachedStore = undefined;
}
