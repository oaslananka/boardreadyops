export const BACKUP_RESTORE_CONFIRMATION: "isolated-empty-database";

export type PostgresBackupRestorePlan = {
  backupPath: string;
  source: { identity: string; database: string };
  restore: { identity: string; database: string };
  dump: { command: string; args: string[]; environment: Record<string, string>; outputPath: string };
  restoreCommand: { command: string; args: string[]; environment: Record<string, string> };
};

export type PostgresBackupRestoreResult = {
  event: "postgres_backup_restore_verified";
  backupBytes: number;
  migrationCount: number;
  publicTableCount: number;
  representativeRows: number;
};

export function databaseIdentity(connectionString: string): string;
export function buildPostgresCommandEnvironment(
  baseEnvironment: Readonly<Record<string, string | undefined>>,
  postgresEnvironment: Readonly<Record<string, string>>,
): Record<string, string>;
export function buildPostgresBackupRestorePlan(input: {
  sourceUrl: string;
  restoreUrl: string;
  backupPath: string;
  confirmation: string;
  pgDumpCommand?: string;
  pgRestoreCommand?: string;
}): PostgresBackupRestorePlan;
export function verifyPostgresBackupRestore(
  input: {
    sourceUrl: string;
    restoreUrl: string;
    backupPath: string;
    confirmation: string;
    pgDumpCommand?: string;
    pgRestoreCommand?: string;
  },
  dependencies?: {
    createExecutor?: (connectionString: string) => {
      query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
      close(): Promise<void>;
    };
    readMigrationFiles?: () => Promise<string[]>;
    runCommand?: (command: {
      command: string;
      args: string[];
      environment: Record<string, string>;
      outputPath?: string;
    }) => void | Promise<void>;
    fileSize?: (backupPath: string) => Promise<number>;
    backupPathExists?: (backupPath: string) => Promise<boolean>;
  },
): Promise<PostgresBackupRestoreResult>;
