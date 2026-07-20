import { createNoopGitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";
import { createSqlGitHubAppLifecycleStore } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

let cachedStore;

export function getGitHubAppLifecycleStore() {
  if (cachedStore) {
    return cachedStore;
  }

  const configuration = resolveCloudPersistenceConfiguration();

  if (configuration.mode === "memory") {
    cachedStore = createNoopGitHubAppLifecycleStore();
    return cachedStore;
  }

  cachedStore = createSqlGitHubAppLifecycleStore(
    createPgQueryExecutor({
      connectionString: configuration.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    }),
  );
  return cachedStore;
}

export function resetGitHubAppLifecycleStoreForTests() {
  cachedStore = undefined;
}
