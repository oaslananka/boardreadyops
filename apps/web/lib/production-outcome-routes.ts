import {
  parseProductionOutcomeCsv,
  parseProductionOutcomeJson,
  type ProductionBatchInput,
} from "@boardreadyops/cloud-core/production-outcomes";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import {
  createSqlProductionOutcomeStore,
  type ProductionOutcomeStore,
} from "@boardreadyops/db/production-outcome-store";
import {
  type AuthenticatedApiContext,
  authenticateApiRequest,
  type RepositoryApiContext,
  resolveRepositoryApiContext,
} from "./api-auth.js";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "./bounded-request-body.js";

const maximumImportBytes = 2 * 1024 * 1024;
const maximumSourceNameLength = 255;

type ApiAuthResult = Awaited<ReturnType<typeof authenticateApiRequest>>;

export type ProductionOutcomeImportDependencies = {
  authenticate(request: Request, requiredScope: "runs:write"): Promise<ApiAuthResult>;
  resolveRepository(
    auth: AuthenticatedApiContext,
    request: Request,
    explicitRepositoryId?: string,
  ): Promise<RepositoryApiContext | Response>;
  createStore(executor: SqlQueryExecutor): ProductionOutcomeStore;
};

const defaultDependencies: ProductionOutcomeImportDependencies = {
  authenticate(request, requiredScope) {
    return authenticateApiRequest(request, requiredScope);
  },
  resolveRepository(auth, request, explicitRepositoryId) {
    return explicitRepositoryId === undefined
      ? resolveRepositoryApiContext(auth, request)
      : resolveRepositoryApiContext(auth, request, explicitRepositoryId);
  },
  createStore: createSqlProductionOutcomeStore,
};

type QueryResult = { rows?: readonly Record<string, unknown>[] };

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as QueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function installationId(row: Record<string, unknown> | undefined): string | undefined {
  const value = row?.installation_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mediaType(request: Request): string {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function sourceName(request: Request): string | undefined | Response {
  const value = new URL(request.url).searchParams.get("sourceName")?.trim();
  if (!value) return undefined;
  if (value.length > maximumSourceNameLength) {
    return Response.json({ ok: false, error: "sourceName exceeds 255 characters" }, { status: 400 });
  }
  return value;
}

async function releaseInstallationId(
  executor: SqlQueryExecutor,
  repositoryId: string,
  releaseRunId: string,
): Promise<string | undefined> {
  const result = await executor.query(
    `select repositories.installation_id
       from release_runs
       join repositories on repositories.id = release_runs.repository_id
      where release_runs.id = $1
        and repositories.id = $2
      limit 1`,
    [releaseRunId, repositoryId],
  );
  return installationId(rows(result)[0]);
}

function validationMessage(error: unknown, format: "csv" | "json"): string {
  const fallback = format === "csv" ? "Invalid production outcome CSV" : "Invalid production outcome JSON";
  if (!(error instanceof Error)) return fallback;
  if (
    format === "csv" &&
    !error.message.startsWith("Production outcome CSV") &&
    !error.message.startsWith("CSV row")
  ) {
    return fallback;
  }
  if (format === "json" && !error.message.startsWith("Production outcome JSON")) return fallback;
  return error.message;
}

type ParsedImport = {
  batch: ProductionBatchInput;
  sourceKind: "csv" | "api";
  sourceSha256: string;
};

function parseImportBody(contentType: string, body: Buffer): ParsedImport {
  const text = body.toString("utf8");
  if (contentType === "application/json") {
    const parsed = parseProductionOutcomeJson(text);
    return { batch: parsed.batch, sourceKind: "api", sourceSha256: parsed.sourceSha256 };
  }

  const parsed = parseProductionOutcomeCsv(text);
  if (parsed.batches.length !== 1) {
    throw new Error("CSV import currently accepts exactly one production batch per request");
  }
  const batch = parsed.batches[0];
  if (!batch) throw new Error("Production outcome CSV has no data rows");
  return { batch, sourceKind: "csv", sourceSha256: parsed.sourceSha256 };
}

/**
 * Imports one manufacturing batch from CSV or JSON and binds it to the exact release run in the
 * route.
 *
 * Repository authorization happens before the body is read. The release is then required to
 * belong to that exact repository, which prevents a repository-scoped bearer token from writing
 * to another repository that happens to share the same GitHub App installation.
 *
 * Both formats intentionally accept one batch per request. CSV may contain many rows for the same
 * batch so defects can remain row-oriented; JSON accepts one canonical batch object. Keeping the
 * write atomic avoids partially imported documents when immutable evidence conflicts.
 */
export async function handleProductionOutcomeCsvImport(
  request: Request,
  releaseRunId: string,
  dependencies: ProductionOutcomeImportDependencies = defaultDependencies,
): Promise<Response> {
  if (!releaseRunId.trim()) {
    return Response.json({ ok: false, error: "runId is required" }, { status: 400 });
  }

  const auth = await dependencies.authenticate(request, "runs:write");
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const contentType = mediaType(request);
  if (contentType !== "text/csv" && contentType !== "application/json") {
    return Response.json(
      { ok: false, error: "Content-Type must be text/csv or application/json" },
      { status: 415 },
    );
  }

  const selectedSourceName = sourceName(request);
  if (selectedSourceName instanceof Response) return selectedSourceName;

  const scope = await dependencies.resolveRepository(auth, request);
  if (scope instanceof Response) return scope;

  try {
    const installation = await releaseInstallationId(scope.executor, scope.repositoryId, releaseRunId);
    if (!installation) {
      return Response.json({ ok: false, error: "Release run is unavailable for this repository" }, { status: 404 });
    }

    let body: Buffer;
    try {
      body = await readBoundedRequestBody(request, maximumImportBytes);
    } catch (error) {
      const format = contentType === "application/json" ? "JSON" : "CSV";
      if (error instanceof RequestBodyTooLargeError) {
        return Response.json(
          { ok: false, error: `Production outcome ${format} exceeds the 2 MiB import limit` },
          { status: 413 },
        );
      }
      return Response.json(
        { ok: false, error: `Production outcome ${format} could not be read` },
        { status: 400 },
      );
    }

    const format = contentType === "application/json" ? "json" : "csv";
    let parsed: ParsedImport;
    try {
      parsed = parseImportBody(contentType, body);
    } catch (error) {
      return Response.json({ ok: false, error: validationMessage(error, format) }, { status: 400 });
    }

    try {
      const imported = await dependencies.createStore(scope.executor).importBatch({
        installationId: installation,
        releaseRunId,
        batch: parsed.batch,
        sourceKind: parsed.sourceKind,
        sourceSha256: parsed.sourceSha256,
        ...(selectedSourceName ? { sourceName: selectedSourceName } : {}),
      });

      return Response.json(
        {
          ok: true,
          batchId: imported.id,
          created: imported.created,
          releaseRunId,
          sourceSha256: parsed.sourceSha256,
        },
        { status: imported.created ? 201 : 200 },
      );
    } catch {
      return Response.json(
        { ok: false, error: "Production batch conflicts with existing release evidence" },
        { status: 409 },
      );
    }
  } finally {
    await scope.executor.close();
  }
}
