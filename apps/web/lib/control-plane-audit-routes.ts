import { type AuditLogStore, createSqlAuditLogStore } from "@boardreadyops/db/audit-log-store";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateControlPlaneOperator } from "./control-plane-operator-auth.js";
import { controlPlaneJsonError, controlPlaneJsonResponse } from "./control-plane-operator-response.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const eventTypePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/u;

type AuditOperations = Pick<AuditLogStore, "listAuditEvents">;

export type ControlPlaneAuditRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  queryExecutor(): SqlQueryExecutor | undefined;
  createAuditLogStore(executor: SqlQueryExecutor): AuditOperations;
};

export type ControlPlaneAuditRouteFactories = {
  createQueryExecutor(options: { connectionString: string; max: number }): SqlQueryExecutor;
  createAuditLogStore(executor: SqlQueryExecutor): AuditOperations;
};

const defaultFactories: ControlPlaneAuditRouteFactories = {
  createQueryExecutor: createPgQueryExecutor,
  createAuditLogStore: createSqlAuditLogStore,
};

export function createControlPlaneAuditRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  factories: ControlPlaneAuditRouteFactories = defaultFactories,
): ControlPlaneAuditRouteDependencies {
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
    createAuditLogStore: factories.createAuditLogStore,
  };
}

function authenticated(request: Request, dependencies: ControlPlaneAuditRouteDependencies): Response | true {
  const authentication = authenticateControlPlaneOperator(request, dependencies.environment);
  if (authentication.status === "disabled") return controlPlaneJsonError("operator API is not configured", 503);
  if (authentication.status === "unauthorized") {
    return controlPlaneJsonError("operator authentication is required", 401, { "www-authenticate": "Bearer" });
  }
  return true;
}

function validIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}

function decodeCursor(raw: string): { createdAt: Date; id: string } | undefined {
  if (!cursorPattern.test(raw)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const createdAtValue = (parsed as Record<string, unknown>).createdAt;
    const id = (parsed as Record<string, unknown>).id;
    if (typeof createdAtValue !== "string" || typeof id !== "string" || !validIdentifier(id)) return undefined;
    const createdAt = new Date(createdAtValue);
    return Number.isFinite(createdAt.valueOf()) ? { createdAt, id } : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(input: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

type ParsedAuditQuery = {
  limit: number;
  repositoryId?: string;
  releaseRunId?: string;
  eventType?: string;
  cursor?: { createdAt: Date; id: string };
};

function parsedLimit(searchParams: URLSearchParams): number | Response {
  const raw = searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^[1-9]\d{0,2}$/u.test(raw)) return controlPlaneJsonError("audit limit is invalid", 400);
  const limit = Number(raw);
  return limit <= 100 ? limit : controlPlaneJsonError("audit limit is invalid", 400);
}

function parsedIdentifierFilter(
  searchParams: URLSearchParams,
  name: "releaseRunId" | "repositoryId",
  error: string,
): string | Response | undefined {
  const value = searchParams.get(name) ?? undefined;
  return value === undefined || validIdentifier(value) ? value : controlPlaneJsonError(error, 400);
}

function parsedEventType(searchParams: URLSearchParams): string | Response | undefined {
  const value = searchParams.get("eventType") ?? undefined;
  if (value === undefined) return undefined;
  if (value.length <= 160 && eventTypePattern.test(value)) return value;
  return controlPlaneJsonError("audit event-type filter is invalid", 400);
}

function parsedCursor(searchParams: URLSearchParams): ParsedAuditQuery["cursor"] | Response {
  const raw = searchParams.get("cursor");
  if (raw === null) return undefined;
  return decodeCursor(raw) ?? controlPlaneJsonError("audit cursor is invalid", 400);
}

function parsedQuery(request: Request): ParsedAuditQuery | Response {
  const searchParams = new URL(request.url).searchParams;
  const limit = parsedLimit(searchParams);
  if (limit instanceof Response) return limit;
  const repositoryId = parsedIdentifierFilter(searchParams, "repositoryId", "audit repository filter is invalid");
  if (repositoryId instanceof Response) return repositoryId;
  const releaseRunId = parsedIdentifierFilter(searchParams, "releaseRunId", "audit release-run filter is invalid");
  if (releaseRunId instanceof Response) return releaseRunId;
  const eventType = parsedEventType(searchParams);
  if (eventType instanceof Response) return eventType;
  const cursor = parsedCursor(searchParams);
  if (cursor instanceof Response) return cursor;

  return {
    limit,
    ...(repositoryId ? { repositoryId } : {}),
    ...(releaseRunId ? { releaseRunId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export async function handleControlPlaneAuditListRequest(
  request: Request,
  installationId: string,
  dependencies: ControlPlaneAuditRouteDependencies = createControlPlaneAuditRouteDependencies(),
): Promise<Response> {
  const authentication = authenticated(request, dependencies);
  if (authentication instanceof Response) return authentication;
  if (!validIdentifier(installationId)) return controlPlaneJsonError("installation identifier is invalid", 400);
  const query = parsedQuery(request);
  if (query instanceof Response) return query;

  const executor = dependencies.queryExecutor();
  if (!executor) return controlPlaneJsonError("database is not configured", 503);

  try {
    const items = await dependencies.createAuditLogStore(executor).listAuditEvents({
      installationId,
      limit: query.limit,
      ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
      ...(query.releaseRunId ? { releaseRunId: query.releaseRunId } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const lastItem = items.length === query.limit ? items.at(-1) : undefined;
    return controlPlaneJsonResponse(
      {
        ok: true,
        items,
        ...(lastItem ? { nextCursor: encodeCursor({ createdAt: lastItem.createdAt, id: lastItem.id }) } : {}),
      },
      200,
    );
  } catch {
    return controlPlaneJsonError("audit export is temporarily unavailable", 503);
  }
}
