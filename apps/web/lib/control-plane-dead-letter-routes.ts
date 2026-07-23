import {
  type ControlPlaneDeadLetterItemType,
  type ControlPlaneOperationsStore,
  createSqlControlPlaneOperationsStore,
} from "@boardreadyops/db/control-plane-operations-store";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateControlPlaneOperator } from "./control-plane-operator-auth.js";

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

function jsonResponse(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function jsonError(error: string, status: number, headers?: Readonly<Record<string, string>>): Response {
  return jsonResponse({ ok: false, error }, status, headers);
}

function defaultQueryExecutor(environment: Readonly<Record<string, string | undefined>>): SqlQueryExecutor | undefined {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return undefined;
  return createPgQueryExecutor({
    connectionString,
    max: Number(environment.DATABASE_POOL_MAX ?? 5),
  });
}

const defaultEnvironment = process.env;

const defaultDependencies: ControlPlaneDeadLetterRouteDependencies = {
  environment: defaultEnvironment,
  queryExecutor: () => defaultQueryExecutor(defaultEnvironment),
  createOperationsStore: (executor) => createSqlControlPlaneOperationsStore(executor),
};

function authenticatedActor(
  request: Request,
  dependencies: ControlPlaneDeadLetterRouteDependencies,
): { actorId: string } | Response {
  const authentication = authenticateControlPlaneOperator(request, dependencies.environment);
  if (authentication.status === "disabled") {
    return jsonError("operator API is not configured", 503);
  }
  if (authentication.status === "unauthorized") {
    return jsonError("operator authentication is required", 401, { "www-authenticate": "Bearer" });
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
    if (!/^[1-9]\d{0,2}$/u.test(rawLimit)) return jsonError("dead-letter limit is invalid", 400);
    limit = Number(rawLimit);
    if (limit > 100) return jsonError("dead-letter limit is invalid", 400);
  }

  const rawBefore = url.searchParams.get("before");
  if (rawBefore === null) return { limit };
  if (rawBefore.length > 64) return jsonError("dead-letter cursor is invalid", 400);
  const before = new Date(rawBefore);
  if (!Number.isFinite(before.valueOf())) return jsonError("dead-letter cursor is invalid", 400);
  return { limit, before };
}

function operationsStore(dependencies: ControlPlaneDeadLetterRouteDependencies): DeadLetterOperations | Response {
  const executor = dependencies.queryExecutor();
  if (!executor) return jsonError("database is not configured", 503);
  return dependencies.createOperationsStore(executor);
}

export async function handleControlPlaneDeadLetterListRequest(
  request: Request,
  installationId: string,
  dependencies: ControlPlaneDeadLetterRouteDependencies = defaultDependencies,
): Promise<Response> {
  const actor = authenticatedActor(request, dependencies);
  if (actor instanceof Response) return actor;
  if (!validIdentifier(installationId)) return jsonError("installation identifier is invalid", 400);

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
    const nextBefore = items.length === query.limit ? items.at(-1)?.failedAt : undefined;
    return jsonResponse(
      {
        ok: true,
        items,
        ...(nextBefore ? { nextBefore } : {}),
      },
      200,
    );
  } catch {
    return jsonError("dead-letter listing is temporarily unavailable", 503);
  }
}

export async function handleControlPlaneDeadLetterReplayRequest(
  request: Request,
  params: ReplayRouteParams,
  dependencies: ControlPlaneDeadLetterRouteDependencies = defaultDependencies,
): Promise<Response> {
  const actor = authenticatedActor(request, dependencies);
  if (actor instanceof Response) return actor;

  if (
    !validIdentifier(params.installationId) ||
    !validIdentifier(params.itemId) ||
    !supportedItemTypes.has(params.itemType as ControlPlaneDeadLetterItemType)
  ) {
    return jsonError("dead-letter replay target is invalid", 400);
  }

  const operationId = request.headers.get("idempotency-key") ?? "";
  if (!validIdentifier(operationId)) return jsonError("Idempotency-Key header is required", 400);

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

    if (result.outcome === "not_found") return jsonError("dead-letter item not found", 404);
    if (result.outcome === "not_replayable") {
      return jsonError("dead-letter item is not safely replayable", 409);
    }
    return jsonResponse(
      {
        ok: true,
        outcome: result.outcome,
        ...(result.auditEventId ? { auditEventId: result.auditEventId } : {}),
      },
      200,
    );
  } catch {
    return jsonError("dead-letter replay is temporarily unavailable", 503);
  }
}
