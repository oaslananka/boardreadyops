import { verifyGitHubActionsOidcToken } from "../../../../../lib/github-actions-oidc.js";
import { resultOidcExpectations } from "../../../../../lib/result-oidc-expectations.js";
import { defaultResultRouteDependencies, handleResultRequest } from "../result/route.js";

export const runtime = "nodejs";

const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  const match = authorization === null ? null : /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  return match?.[1];
}

export async function POST(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const runId = searchParams.get("run_id") ?? "";
  const executionAttemptId = searchParams.get("attempt_id") ?? "";
  const token = bearerToken(request);

  if (!lowercaseUuidPattern.test(runId) || !lowercaseUuidPattern.test(executionAttemptId)) {
    return Response.json(
      { ok: false, error: "valid run_id and attempt_id query parameters are required" },
      { status: 400 },
    );
  }
  if (!token) {
    return Response.json({ ok: false, error: "GitHub Actions OIDC authentication is required" }, { status: 401 });
  }

  const executor = defaultResultRouteDependencies.queryExecutor();
  if (!executor) {
    return Response.json({ ok: false, error: "database is not configured" }, { status: 503 });
  }

  let expectations: Awaited<ReturnType<typeof resultOidcExpectations>>;
  try {
    expectations = await resultOidcExpectations(executor, runId, executionAttemptId);
  } catch {
    return Response.json({ ok: false, error: "result authentication database lookup failed" }, { status: 503 });
  }

  if (!expectations || !(await verifyGitHubActionsOidcToken(token, expectations))) {
    return Response.json({ ok: false, error: "invalid GitHub Actions OIDC authentication" }, { status: 401 });
  }

  return handleResultRequest(request, {
    ...defaultResultRouteDependencies,
    queryExecutor: () => executor,
    authenticationVerified: true,
  });
}
