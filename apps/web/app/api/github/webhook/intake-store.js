import {
  createMemoryControlPlaneJobStore,
  createSqlControlPlaneJobStore,
} from "@boardreadyops/db/control-plane-job-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  resolveCloudPersistenceConfiguration,
  resolveControlPlaneRetentionConfiguration,
} from "../../../../lib/cloud-runtime-config.js";

let cachedStore;

export function getControlPlaneJobStore() {
  if (cachedStore) return cachedStore;

  const configuration = resolveCloudPersistenceConfiguration();
  if (configuration.mode === "memory") {
    cachedStore = createMemoryControlPlaneJobStore();
    return cachedStore;
  }

  const retention = resolveControlPlaneRetentionConfiguration();
  cachedStore = createSqlControlPlaneJobStore(
    createPgQueryExecutor({
      connectionString: configuration.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    }),
    { retentionDays: retention.webhookInboxDays },
  );
  return cachedStore;
}

export function resetControlPlaneJobStoreForTests() {
  cachedStore = undefined;
}

export function setControlPlaneJobStoreForTests(store) {
  cachedStore = store;
}
