import { runnerRegistrationActivationRequestSchema } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  createSqlRunnerRegistrationEnrollmentStore,
  type RunnerRegistrationEnrollmentStore,
} from "@boardreadyops/db/runner-registration-enrollment-store";

const maximumActivationBodyBytes = 32 * 1024;

type ParsedBody = { ok: true; value: unknown } | { ok: false; response: Response };

export type RunnerRegistrationActivationRouteDependencies = {
  queryExecutor(): SqlQueryExecutor | undefined;
  createEnrollmentStore(executor: SqlQueryExecutor): RunnerRegistrationEnrollmentStore;
};

function jsonResponse(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function createDefaultQueryExecutor(): SqlQueryExecutor | undefined {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  return createPgQueryExecutor({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
}

async function parseBody(request: Request): Promise<ParsedBody> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength) || String(Number(contentLength)) !== contentLength) {
      return {
        ok: false,
        response: jsonResponse({ ok: false, error: "runner activation content length is invalid" }, 400),
      };
    }
    if (Number(contentLength) > maximumActivationBodyBytes) {
      return {
        ok: false,
        response: jsonResponse({ ok: false, error: "runner activation payload is too large" }, 413),
      };
    }
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maximumActivationBodyBytes) {
    return {
      ok: false,
      response: jsonResponse({ ok: false, error: "runner activation payload is too large" }, 413),
    };
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ ok: false, error: "invalid runner activation JSON" }, 400),
    };
  }
}

const defaultDependencies: RunnerRegistrationActivationRouteDependencies = {
  queryExecutor: createDefaultQueryExecutor,
  createEnrollmentStore: (executor) => createSqlRunnerRegistrationEnrollmentStore(executor),
};

export async function handleRunnerRegistrationActivationRequest(
  request: Request,
  dependencies: RunnerRegistrationActivationRouteDependencies = defaultDependencies,
): Promise<Response> {
  const body = await parseBody(request);
  if (!body.ok) return body.response;

  const parsed = runnerRegistrationActivationRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid runner activation request" }, 400);
  }

  const executor = dependencies.queryExecutor();
  if (!executor) {
    return jsonResponse({ ok: false, error: "database is not configured" }, 503);
  }

  let activation: Awaited<ReturnType<RunnerRegistrationEnrollmentStore["activateRegistration"]>>;
  try {
    activation = await dependencies.createEnrollmentStore(executor).activateRegistration({
      enrollmentToken: parsed.data.enrollmentToken,
      publicKey: parsed.data.publicKey,
      capabilities: parsed.data.capabilities,
    });
  } catch {
    return jsonResponse({ ok: false, error: "runner activation is temporarily unavailable" }, 503);
  }

  if (activation.status === "stale") {
    return jsonResponse({ ok: false, error: "runner enrollment is invalid or expired" }, 401);
  }
  if (activation.status === "conflict") {
    return jsonResponse({ ok: false, error: "runner enrollment conflicts with an existing registration" }, 409);
  }

  const status = activation.status === "accepted" ? "activated" : "replayed";
  return jsonResponse(
    {
      protocolVersion: 1,
      status,
      registrationId: activation.registrationId,
    },
    status === "activated" ? 201 : 200,
  );
}
