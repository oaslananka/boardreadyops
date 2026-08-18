export const RESTORE_DRILL_CONFIRMATION: "isolated-disposable-database";

export type PostgresRestoreDrillPlan = {
  sourceIdentity: string;
  restoreIdentity: string;
  backupPath: string;
};

export type PostgresRestoreDrillBackupResult = {
  event: string;
  backupBytes: number;
  migrationCount: number;
  publicTableCount: number;
  representativeRows: number;
};

export type PostgresRestoreDrillResult = {
  event: "postgres_restore_readiness_verified";
  backupBytes: number;
  migrationCount: number;
  publicTableCount: number;
  representativeRows: number;
  restoredRunStateVerified: true;
};

export function buildPostgresRestoreDrillPlan(input: {
  sourceUrl: string;
  restoreUrl: string;
  backupPath: string;
  confirmation: string;
}): PostgresRestoreDrillPlan;

export function summarizePostgresRestoreDrill(input: {
  backup: PostgresRestoreDrillBackupResult;
  restoredRunStateVerified: boolean;
}): PostgresRestoreDrillResult;

export function runPostgresRestoreDrill(
  input: {
    sourceUrl: string;
    restoreUrl: string;
    backupPath: string;
    confirmation: string;
  },
  dependencies?: {
    createExecutor?: (connectionString: string) => {
      query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
      close(): Promise<void>;
    };
    verifyBackupRestore?: (input: {
      sourceUrl: string;
      restoreUrl: string;
      backupPath: string;
      confirmation: string;
    }) => Promise<PostgresRestoreDrillBackupResult>;
    backupPathExists?: (backupPath: string) => Promise<boolean>;
    removeFile?: (backupPath: string) => Promise<void>;
  },
): Promise<PostgresRestoreDrillResult>;
