import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  createSqlRunnerFleetHealthStore,
  type RunnerFleetHealthStore,
} from "@boardreadyops/db/runner-fleet-health-store";
import { authenticateControlPlaneOperator } from "./control-plane-operator-auth.js";
import { controlPlaneJsonError, controlPlaneJsonResponse } from "./control-plane-operator-response.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const observationWindowSeconds = 300;

export type ControlPlaneRunnerFleetRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  now(): Date;
  queryExecutor(): SqlQueryExecutor | undefined;
  createRunnerFleetHealthStore(executor: SqlQueryExecutor): RunnerFleetHealthStore;
};

export type ControlPlaneRunnerFleetRouteFactories = {
  createQueryExecutor(options: { connectionString: string; max: number }): SqlQueryExecutor;
  createRunnerFleetHealthStore(executor: SqlQueryExecutor): RunnerFleetHealthStore;
};

const defaultFactories: ControlPlaneRunnerFleetRouteFactories = {
  createQueryExecutor: createPgQueryExecutor,
  createRunnerFleetHealthStore: createSqlRunnerFleetHealthStore,
};

export function createControlPlaneRunnerFleetRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  factories: ControlPlaneRunnerFleetRouteFactories = defaultFactories,
): ControlPlaneRunnerFleetRouteDependencies {
  return {
    environment,
    now: () => new Date(),
    queryExecutor() {
      const connectionString = environment.DATABASE_URL;
      if (!connectionString) return undefined;
      return factories.createQueryExecutor({
        connectionString,
        max: Number(environment.DATABASE_POOL_MAX ?? 5),
      });
    },
    createRunnerFleetHealthStore: factories.createRunnerFleetHealthStore,
  };
}

function authenticated(request: Request, dependencies: ControlPlaneRunnerFleetRouteDependencies): Response | true {
  const authentication = authenticateControlPlaneOperator(request, dependencies.environment);
  if (authentication.status === "disabled") return controlPlaneJsonError("operator API is not configured", 503);
  if (authentication.status === "rate_limited") {
    return controlPlaneJsonError(
      `Too many failed authentication attempts, retry after ${authentication.retryAfterSeconds}s`,
      429,
      { "retry-after": String(authentication.retryAfterSeconds) },
    );
  }
  if (authentication.status === "unauthorized") {
    return controlPlaneJsonError("operator authentication is required", 401, { "www-authenticate": "Bearer" });
  }
  return true;
}

export async function handleControlPlaneRunnerFleetRequest(
  request: Request,
  installationId: string,
  dependencies: ControlPlaneRunnerFleetRouteDependencies = createControlPlaneRunnerFleetRouteDependencies(),
): Promise<Response> {
  const authentication = authenticated(request, dependencies);
  if (authentication instanceof Response) return authentication;
  if (!identifierPattern.test(installationId)) return controlPlaneJsonError("installation identifier is invalid", 400);

  const executor = dependencies.queryExecutor();
  if (!executor) return controlPlaneJsonError("database is not configured", 503);

  try {
    const fleet = await dependencies.createRunnerFleetHealthStore(executor).readFleetHealth({
      installationId,
      observedAt: dependencies.now(),
      observationWindowSeconds,
    });
    if (!fleet) return controlPlaneJsonError("installation was not found", 404);
    return controlPlaneJsonResponse({ ok: true, fleet }, 200);
  } catch {
    return controlPlaneJsonError("runner fleet health is temporarily unavailable", 503);
  }
}
