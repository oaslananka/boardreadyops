import type { SqlQueryExecutor } from "../packages/db/src/lifecycle-store.js";

export interface MigrationResult {
  workspacesCreated: number;
  projectsCreated: number;
}

export function migrateInstallationsToWorkspaces(executor: SqlQueryExecutor): Promise<MigrationResult>;
