export const TOOLCHAIN_DATABASE_URL: string;

export function getPostgresTestConnectionString(environment?: NodeJS.ProcessEnv): string | undefined;
