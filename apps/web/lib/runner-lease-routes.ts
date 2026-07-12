import {
  runnerClaimRequestSchema,
  runnerClaimResponseSchema,
  runnerLeaseHeartbeatRequestSchema,
  runnerLeaseHeartbeatResponseSchema,
  runnerLeaseRelinquishRequestSchema,
  runnerMutationResponseSchema,
} from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  createSqlRunnerLeaseStore,
  type RunnerLeaseStore,
  type RunnerWorkerIdentity,
} from "@boardreadyops/db/runner-lease-store";
import { authenticateRunnerRequest } from "./runner-request-auth.js";

export type RunnerLeaseRouteDependencies = {
  queryExecutor: () => SqlQueryExecutor | undefined;
  createLeaseStore: (executor: SqlQueryExecutor) => RunnerLeaseStore;
  now: () => Date;
};

type ParsedBody = { ok: true; text: string; value: unknown } | { ok: false; response: Response };

const maximumRunnerRequestBodyBytes = 64 * 1024;

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function parseRequestBody(request: Request): Promise<ParsedBody> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumRunnerRequestBodyBytes) {
      return { ok: false, response: jsonResponse({ ok: false, error: "runner request payload is too large" }, 413) };
    }
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumRunnerRequestBodyBytes) {
    return { ok: false, response: jsonResponse({ ok: false, error: "runner request payload is too large" }, 413) };
  }

  try {
    return { ok: true, text, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonResponse({ ok: false, error: "invalid runner request JSON" }, 400) };
  }
}

function createDefaultQueryExecutor(): SqlQueryExecutor | undefined {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  return createPgQueryExecutor({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
}

const defaultDependencies: RunnerLeaseRouteDependencies = {
  queryExecutor: createDefaultQueryExecutor,
  createLeaseStore: (executor) => createSqlRunnerLeaseStore(executor),
  now: () => new Date(),
};

function unavailable(): Response {
  return jsonResponse({ ok: false, error: "runner lease service is unavailable" }, 503);
}

function unauthorized(): Response {
  return jsonResponse({ ok: false, error: "invalid runner request authentication" }, 401);
}

function identityMatchesWorkerClass(identity: RunnerWorkerIdentity, workerClass: "managed" | "self_hosted"): boolean {
  return identity.workerClass === workerClass;
}

function eligibilityCapabilities(capabilities: readonly string[], labels: readonly string[]): string[] | undefined {
  const values = Array.from(new Set([...capabilities, ...labels])).sort();
  return values.length <= 64 ? values : undefined;
}

export async function handleRunnerClaimRequest(
  request: Request,
  dependencies: RunnerLeaseRouteDependencies = defaultDependencies,
): Promise<Response> {
  const body = await parseRequestBody(request);
  if (!body.ok) return body.response;

  const parsed = runnerClaimRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid runner claim request" }, 400);
  }

  const executor = dependencies.queryExecutor();
  if (!executor) return unavailable();

  const authenticated = await authenticateRunnerRequest({
    request,
    body: body.text,
    executor,
    now: dependencies.now(),
  });
  if (!authenticated) return unauthorized();
  if (!identityMatchesWorkerClass(authenticated.identity, parsed.data.workerClass)) {
    return jsonResponse({ ok: false, error: "runner worker class does not match the signed identity" }, 400);
  }

  const capabilities = eligibilityCapabilities(parsed.data.capabilities, parsed.data.labels);
  if (!capabilities) {
    return jsonResponse({ ok: false, error: "runner claim has too many capability selectors" }, 400);
  }

  try {
    const result = await dependencies.createLeaseStore(executor).claimJob({
      ...authenticated.identity,
      requestTimestamp: authenticated.envelope.timestamp,
      requestNonce: authenticated.envelope.nonce,
      capabilities,
    });

    if (result.status === "claimed") {
      return jsonResponse(
        runnerClaimResponseSchema.parse({
          protocolVersion: 1,
          status: "claimed",
          job: {
            leaseId: result.leaseId,
            leaseToken: result.leaseToken,
            runId: result.runId,
            executionAttemptId: result.executionAttemptId,
            leaseExpiresAt: result.leaseExpiresAt,
            maximumLeaseExpiresAt: result.maximumLeaseExpiresAt,
            sourceMode: result.sourceMode,
            repository: result.repository,
            safeMode: result.safeMode,
          },
        }),
      );
    }
    if (result.status === "empty") {
      return jsonResponse(
        runnerClaimResponseSchema.parse({
          protocolVersion: 1,
          status: "empty",
          retryAfterSeconds: result.retryAfterSeconds,
        }),
      );
    }
    if (result.status === "replayed") {
      return jsonResponse({ ok: false, error: "runner claim request was replayed" }, 409);
    }
    return jsonResponse(
      {
        ok: false,
        error:
          result.reason === "stale_request"
            ? "runner claim request is outside the clock tolerance"
            : "invalid runner claim request",
      },
      result.reason === "stale_request" ? 401 : 400,
    );
  } catch {
    return unavailable();
  }
}

export async function handleRunnerHeartbeatRequest(
  request: Request,
  dependencies: RunnerLeaseRouteDependencies = defaultDependencies,
): Promise<Response> {
  const body = await parseRequestBody(request);
  if (!body.ok) return body.response;

  const parsed = runnerLeaseHeartbeatRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid runner heartbeat request" }, 400);
  }

  const executor = dependencies.queryExecutor();
  if (!executor) return unavailable();

  const authenticated = await authenticateRunnerRequest({
    request,
    body: body.text,
    executor,
    now: dependencies.now(),
    context: {
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
    },
  });
  if (!authenticated) return unauthorized();

  try {
    const result = await dependencies.createLeaseStore(executor).heartbeat({
      ...authenticated.identity,
      requestTimestamp: authenticated.envelope.timestamp,
      requestNonce: authenticated.envelope.nonce,
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
      leaseToken: parsed.data.leaseToken,
      stage: parsed.data.stage,
      ...(parsed.data.progressPercent === undefined ? {} : { progressPercent: parsed.data.progressPercent }),
      ...(parsed.data.message === undefined ? {} : { message: parsed.data.message }),
    });

    if (result.status === "replayed") {
      return jsonResponse({ ok: false, error: "runner heartbeat request was replayed" }, 409);
    }
    if (result.status === "active") {
      return jsonResponse(
        runnerLeaseHeartbeatResponseSchema.parse({
          protocolVersion: 1,
          status: "active",
          leaseExpiresAt: result.leaseExpiresAt,
          maximumLeaseExpiresAt: result.maximumLeaseExpiresAt,
        }),
      );
    }
    return jsonResponse(
      runnerLeaseHeartbeatResponseSchema.parse({
        protocolVersion: 1,
        status: result.status,
      }),
    );
  } catch {
    return unavailable();
  }
}

export async function handleRunnerRelinquishRequest(
  request: Request,
  dependencies: RunnerLeaseRouteDependencies = defaultDependencies,
): Promise<Response> {
  const body = await parseRequestBody(request);
  if (!body.ok) return body.response;

  const parsed = runnerLeaseRelinquishRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid runner relinquish request" }, 400);
  }

  const executor = dependencies.queryExecutor();
  if (!executor) return unavailable();

  const authenticated = await authenticateRunnerRequest({
    request,
    body: body.text,
    executor,
    now: dependencies.now(),
    context: {
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
    },
  });
  if (!authenticated) return unauthorized();

  try {
    const result = await dependencies.createLeaseStore(executor).relinquish({
      ...authenticated.identity,
      requestTimestamp: authenticated.envelope.timestamp,
      requestNonce: authenticated.envelope.nonce,
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
      leaseToken: parsed.data.leaseToken,
      reason: parsed.data.reason,
      ...(parsed.data.message === undefined ? {} : { message: parsed.data.message }),
    });

    if (result.status === "stale") {
      return jsonResponse({ ok: false, error: "runner lease is stale" }, 409);
    }
    return jsonResponse(
      runnerMutationResponseSchema.parse({
        protocolVersion: 1,
        status: result.status,
      }),
    );
  } catch {
    return unavailable();
  }
}
