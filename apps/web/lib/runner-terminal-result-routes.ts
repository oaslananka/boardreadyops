import { runnerTerminalResultRequestSchema } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import {
  createSqlRunnerTerminalResultAuthorizer,
  type RunnerTerminalResultAuthorizer,
} from "@boardreadyops/db/runner-terminal-result-store";
import {
  defaultResultRouteDependencies,
  handleResultRequest,
  type ResultRouteDependencies,
} from "../app/api/v1/runs/result/route.js";
import { authenticateRunnerRequest } from "./runner-request-auth.js";

const maximumTerminalResultBodyBytes = 1024 * 1024;

export type RunnerTerminalResultRouteDependencies = {
  resultRouteDependencies: ResultRouteDependencies;
  createAuthorizer(executor: SqlQueryExecutor): RunnerTerminalResultAuthorizer;
  persistVerifiedResult(request: Request, dependencies: ResultRouteDependencies): Promise<Response>;
  now(): Date;
};

type ParsedBody = { ok: true; text: string; value: unknown } | { ok: false; response: Response };

type TerminalResultAuthorization = Awaited<ReturnType<RunnerTerminalResultAuthorizer["authorize"]>>;

function jsonResponse(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function parseBody(request: Request): Promise<ParsedBody> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength) || String(Number(contentLength)) !== contentLength) {
      return {
        ok: false,
        response: jsonResponse({ ok: false, error: "runner result content length is invalid" }, 400),
      };
    }
    if (Number(contentLength) > maximumTerminalResultBodyBytes) {
      return { ok: false, response: jsonResponse({ ok: false, error: "runner result payload is too large" }, 413) };
    }
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumTerminalResultBodyBytes) {
    return { ok: false, response: jsonResponse({ ok: false, error: "runner result payload is too large" }, 413) };
  }

  try {
    return { ok: true, text, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonResponse({ ok: false, error: "invalid runner terminal-result JSON" }, 400) };
  }
}

function terminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "timed_out";
}

const defaultDependencies: RunnerTerminalResultRouteDependencies = {
  resultRouteDependencies: defaultResultRouteDependencies,
  createAuthorizer: (executor) => createSqlRunnerTerminalResultAuthorizer(executor),
  persistVerifiedResult: handleResultRequest,
  now: () => new Date(),
};

export async function handleRunnerTerminalResultRequest(
  request: Request,
  dependencies: RunnerTerminalResultRouteDependencies = defaultDependencies,
): Promise<Response> {
  const body = await parseBody(request);
  if (!body.ok) return body.response;

  const parsed = runnerTerminalResultRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: "invalid runner terminal result" }, 400);
  }
  if (!terminalStatus(parsed.data.result.status)) {
    return jsonResponse({ ok: false, error: "runner result status must be terminal" }, 400);
  }
  if (parsed.data.result.executionAttemptId !== parsed.data.executionAttemptId) {
    return jsonResponse({ ok: false, error: "execution attempt does not match terminal-result envelope" }, 400);
  }

  const executor = dependencies.resultRouteDependencies.queryExecutor();
  if (!executor) {
    return jsonResponse({ ok: false, error: "database is not configured" }, 503);
  }

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
  if (!authenticated) {
    return jsonResponse({ ok: false, error: "invalid runner request authentication" }, 401);
  }

  let authorization: TerminalResultAuthorization;
  try {
    authorization = await dependencies.createAuthorizer(executor).authorize({
      ...authenticated.identity,
      requestTimestamp: authenticated.envelope.timestamp,
      requestNonce: authenticated.envelope.nonce,
      runId: parsed.data.runId,
      executionAttemptId: parsed.data.executionAttemptId,
      leaseId: parsed.data.leaseId,
      leaseToken: parsed.data.leaseToken,
      requestBody: body.text,
    });
  } catch {
    return jsonResponse({ ok: false, error: "runner terminal-result authorization is unavailable" }, 503);
  }

  if (authorization.status === "conflicting_replay") {
    return jsonResponse({ ok: false, error: "runner result nonce was reused with another payload" }, 409);
  }
  if (authorization.status === "stale") {
    return jsonResponse({ ok: false, error: "runner lease or execution attempt is stale" }, 409);
  }

  const internalUrl = new URL("https://boardreadyops.internal/api/v1/runs/result");
  internalUrl.searchParams.set("run_id", parsed.data.runId);
  internalUrl.searchParams.set("attempt_id", parsed.data.executionAttemptId);
  const internalRequest = new Request(internalUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.data.result),
  });

  return await dependencies.persistVerifiedResult(internalRequest, {
    ...dependencies.resultRouteDependencies,
    queryExecutor: () => executor,
    authenticationVerified: true,
    verifiedLeaseId: parsed.data.leaseId,
  });
}
