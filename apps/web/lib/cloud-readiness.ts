import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { CloudRuntimeConfigurationError, resolveCloudPersistenceConfiguration } from "./cloud-runtime-config.js";

const service = "boardreadyops-cloud" as const;
const defaultTimeoutMs = 2_000;

export type CloudReadinessResult =
  | {
      ok: true;
      service: typeof service;
      check: "readiness";
      checks: {
        configuration: "pass";
        database: "pass";
      };
    }
  | {
      ok: false;
      service: typeof service;
      check: "readiness";
      reason: "missing-configuration" | "database-unavailable" | "database-timeout";
      missing?: string[];
    };

type Query = (sql: string) => Promise<unknown>;

type CachedPostgresQuery = {
  databaseUrl: string;
  query: Query;
};

class DatabaseReadinessTimeoutError extends Error {}

let cachedPostgresQuery: CachedPostgresQuery | undefined;

function missingRequiredConfiguration(environment: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];

  if (!environment.DATABASE_URL?.trim()) {
    missing.push("DATABASE_URL");
  }
  if (!environment.GITHUB_WEBHOOK_SECRET?.trim()) {
    missing.push("GITHUB_WEBHOOK_SECRET");
  }

  return missing;
}

function defaultPostgresQuery(databaseUrl: string): Query {
  if (cachedPostgresQuery?.databaseUrl === databaseUrl) {
    return cachedPostgresQuery.query;
  }

  const executor = createPgQueryExecutor({ connectionString: databaseUrl, max: 1 });
  const query: Query = async (sql) => await executor.query(sql);
  cachedPostgresQuery = { databaseUrl, query };
  return query;
}

export async function checkCloudReadiness(
  options: { environment?: NodeJS.ProcessEnv; query?: Query; timeoutMs?: number } = {},
): Promise<CloudReadinessResult> {
  const environment = options.environment ?? process.env;
  const missing = missingRequiredConfiguration(environment);

  if (missing.length > 0) {
    return {
      ok: false,
      service,
      check: "readiness",
      reason: "missing-configuration",
      missing,
    };
  }

  let configuration: ReturnType<typeof resolveCloudPersistenceConfiguration>;
  try {
    configuration = resolveCloudPersistenceConfiguration(environment);
  } catch (error) {
    if (error instanceof CloudRuntimeConfigurationError) {
      return {
        ok: false,
        service,
        check: "readiness",
        reason: "missing-configuration",
      };
    }
    throw error;
  }

  if (configuration.mode !== "postgres") {
    return {
      ok: false,
      service,
      check: "readiness",
      reason: "missing-configuration",
    };
  }

  const query = options.query ?? defaultPostgresQuery(configuration.databaseUrl);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      query("select 1 as ready"),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new DatabaseReadinessTimeoutError()), timeoutMs);
      }),
    ]);

    return {
      ok: true,
      service,
      check: "readiness",
      checks: {
        configuration: "pass",
        database: "pass",
      },
    };
  } catch (error) {
    return {
      ok: false,
      service,
      check: "readiness",
      reason: error instanceof DatabaseReadinessTimeoutError ? "database-timeout" : "database-unavailable",
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
