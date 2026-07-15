export type AdminDatabaseUrlOptions = {
  runtimeEnvFile: string;
  outputFile: string;
  host: string;
  port: number;
  dryRun: boolean;
};

export type RuntimePostgresEnvironment = {
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
};

export const defaultAdminDatabaseUrlOptions: AdminDatabaseUrlOptions;

export function readAdminDatabaseUrlOptions(env?: NodeJS.ProcessEnv): AdminDatabaseUrlOptions;

export function parseRuntimeEnvironment(text: string): RuntimePostgresEnvironment;

export function buildAdminDatabaseUrl(input: {
  username: string;
  password: string;
  database: string;
  host: string;
  port: number;
}): string;

export function provisionAdminDatabaseUrl(options?: AdminDatabaseUrlOptions): {
  outputFile: string;
  dryRun: boolean;
};
