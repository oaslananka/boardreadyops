import {
  type ControlPlaneDeadLetterItemType,
  type ControlPlaneOperationsStore,
  createSqlControlPlaneOperationsStore,
} from "@boardreadyops/db/control-plane-operations-store";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateControlPlaneOperator } from "./control-plane-operator-auth.js";
import { controlPlaneJsonError, controlPlaneJsonResponse } from "./control-plane-operator-response.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const supportedItemTypes = new Set<ControlPlaneDeadLetterItemType>(["job", "outbox"]);

type DeadLetterOperations = Pick<ControlPlaneOperationsStore, "listDeadLetters" | "replayDeadLetter">;

export type ControlPlaneDeadLetterRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  queryExecutor(): SqlQueryExecutor | undefined;
  createOperationsStore(executor: SqlQueryExecutor): DeadLetterOperations;
};

type ReplayRouteParams = {
  installationId: string;
  itemType: string;
  itemId: string;
};

export type ControlPlaneDeadLetterRouteFactories = {
  createQueryExecutor(options: { connectionString: string; max: number }): SqlQueryExecutor;
  createOperationsStore(executor: SqlQueryExecutor): DeadLetterOperations;
};

const defaultControlPlaneDeadLetterRouteFactories: ControlPlaneDeadLetterRouteFactories = {
  createQueryExecutor: createPgQueryExecutor,
  createOperationsStore: createSqlControlPlaneOperationsStore,
};

export function createControlPlaneDeadLetterRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  factories: ControlPlaneDeadLetterRouteFactories = defaultControlPlaneDeadLetterRouteFactories,
): ControlPlaneDeadLetterRouteDependencies {
  return {
    environment,
    queryExecutor() {
      const connectionString = environment.DATABASE_URL;
      if (!connectionString) return undefined;
      return factories.createQueryExecutor({
        connectionString,
        max: Number(environment.DATABASE_POOL_MAX ?? 5),
      });
    },
    createOperationsStore: factories.createOperationsStore,
  };
}

function authenticatedActor(
  request: Request,
  dependencies: ControlPlaneDeadLetterRouteDependencies,
): { actorId: string } | Response {
  const authentication = authenticateControlPlaneOperator(request, dependencies.environment);
  if (authentication.status === "disabled") {
    return controlPlaneJsonError("operator API is not configured", 503);
  }
  if (authentication.status === "unauthorized") {
    return controlPlaneJsonError("operator authentication is required", 401, { "www-authenticate": "Bearer" });
  }
  return { actorId: authentication.actorId };
}

function validIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}

function parsedListQuery(request: Request): { limit: number; before?: Date } | Response {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  let limit = 50;
  if (rawLimit !== null) {
    if (!/^[1-9]\d{0,2}$/u.test(rawLimit)) return controlPlaneJsonError("dead-letter limit is invalid", 400);
    limit = Number(rawLimit);
    if (limit > 100) return controlPlaneJsonError("dead-letter limit is invalid", 400);
  }

  const rawBefore = url.searchParams.get("before");
  if (rawBefore === null) return { limit };
  if (rawBefore.length > 64) return controlPlaneJsonError("dead-letter cursor is invalid", 400);
  const before = new Date(rawBefore);
  if (!Number.isFinite(before.valueOf())) return controlPlaneJsonError("dead-letter cursor is invalid", 400);
  return { limit, before };
}

function operationsStore(dependencies: ControlPlaneDeadLetterRouteDependencies): DeadLetterOperations | Response {
  const executor = dependencies.queryExecutor();
  if (!executor) return controlPlaneJsonError("database is not configured", 503);
  return dependencies.createOperationsStore(executor);
}

export async function handleControlPlaneDeadLetterListRequest(
  request: Request,
  installationId: string,
  dependencies: ControlPlaneDeadLetterRouteDependencies = createControlPlaneDeadLetterRouteDependencies(),
): Promise<Response> {
  const actor = authenticatedActor(request, dependencies);
  if (actor instanceof Response) return actor;
  if (!validIdentifier(installationId)) return controlPlaneJsonError("installation identifier is invalid", 400);

  const query = parsedListQuery(request);
  if (query instanceof Response) return query;
  const store = operationsStore(dependencies);
  if (store instanceof Response) return store;

  try {
    const items = await store.listDeadLetters({
      installationId,
      limit: query.limit,
      ...(query.before ? { before: query.before } : {}),
    });
    const lastItem = items.length === query.limit ? items.at(-1) : undefined;
    return controlPlaneJsonResponse(
      {
        ok: true,
        items,
        ...(lastItem ? { nextBefore: lastItem.failedAt } : {}),
      },
      200,
    );
  } catch {
    return controlPlaneJsonError("dead-letter listing is temporarily unavailable", 503);
  }
}

export async function handleControlPlaneDeadLetterReplayRequest(
  request: Request,
  params: ReplayRouteParams,
  dependencies: ControlPlaneDeadLetterRouteDependencies = createControlPlaneDeadLetterRouteDependencies(),
): Promise<Response> {
  const actor = authenticatedActor(request, dependencies);
  if (actor instanceof Response) return actor;

  if (
    !validIdentifier(params.installationId) ||
    !validIdentifier(params.itemId) ||
    !supportedItemTypes.has(params.itemType as ControlPlaneDeadLetterItemType)
  ) {
    return controlPlaneJsonError("dead-letter replay target is invalid", 400);
  }

  const operationId = request.headers.get("idempotency-key") ?? "";
  if (!validIdentifier(operationId)) return controlPlaneJsonError("Idempotency-Key header is required", 400);

  const store = operationsStore(dependencies);
  if (store instanceof Response) return store;

  try {
    const result = await store.replayDeadLetter({
      installationId: params.installationId,
      itemType: params.itemType as ControlPlaneDeadLetterItemType,
      itemId: params.itemId,
      operationId,
      actorId: actor.actorId,
    });

    if (result.outcome === "not_found") return controlPlaneJsonError("dead-letter item not found", 404);
    if (result.outcome === "not_replayable") {
      return controlPlaneJsonError("dead-letter item is not safely replayable", 409);
    }
    return controlPlaneJsonResponse(
      {
        ok: true,
        outcome: result.outcome,
        ...(result.auditEventId ? { auditEventId: result.auditEventId } : {}),
      },
      200,
    );
  } catch {
    return controlPlaneJsonError("dead-letter replay is temporarily unavailable", 503);
  }
}
