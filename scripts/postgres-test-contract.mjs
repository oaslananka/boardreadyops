export const TOOLCHAIN_DATABASE_URL = "postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_toolchain";

export function getPostgresTestConnectionString(environment = process.env) {
  if (environment.BOARDREADYOPS_POSTGRES_TESTS !== "true") return undefined;

  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("BOARDREADYOPS_POSTGRES_TESTS=true requires DATABASE_URL for a disposable PostgreSQL database");
  }
  if (databaseUrl === TOOLCHAIN_DATABASE_URL) {
    throw new Error("The repository-local DATABASE_URL placeholder cannot be used for PostgreSQL integration tests");
  }
  return databaseUrl;
}
