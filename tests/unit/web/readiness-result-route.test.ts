import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../../apps/web/app/api/v1/runs/result/route.js";

const query = vi.fn();
const createPullRequestCheckRun = vi.fn(async () => ({ id: 1 }));
const completeCheckRun = vi.fn();
const createPullRequestComment = vi.fn();
const verifyOidcToken = vi.fn(async () => false);

const dependencies: ResultRouteDependencies = {
  queryExecutor: () => ({ query }),
  checkRunClient: () => ({ createPullRequestCheckRun, completeCheckRun, createPullRequestComment }),
  detailsUrl: (runId) => `https://boardreadyops.test/runs/${encodeURIComponent(runId)}`,
  now: () => new Date("2026-07-10T18:00:00.000Z"),
  verifyOidcToken,
};

const executionAttemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";

const originalEnvironment = {
  resultKey: process.env.BOARDREADYOPS_RUNNER_RESULT_KEY,
  requireSignature: process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE,
  requireOidc: process.env.BOARDREADYOPS_REQUIRE_GITHUB_OIDC,
};

function restoreEnvironment(): void {
  const values: Array<[string, string | undefined]> = [
    ["BOARDREADYOPS_RUNNER_RESULT_KEY", originalEnvironment.resultKey],
    ["BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE", originalEnvironment.requireSignature],
    ["BOARDREADYOPS_REQUIRE_GITHUB_OIDC", originalEnvironment.requireOidc],
  ];

  for (const [name, value] of values) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function signature(key: string, timestamp: string, runId: string, attemptId: string | undefined, body: string): string {
  const signedPayload = attemptId ? `${timestamp}.${runId}.${attemptId}.${body}` : `${timestamp}.${runId}.${body}`;
  return `sha256=${createHmac("sha256", key).update(signedPayload).digest("hex")}`;
}

function bindResultBody(body: string, attemptId: string | undefined): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return JSON.stringify({
        ...(attemptId ? { executionAttemptId: attemptId } : {}),
        ...(parsed as Record<string, unknown>),
      });
    }
  } catch {
    // Preserve malformed payloads so raw-body authentication remains testable.
  }

  return body;
}

function resultRequest(input: {
  body: string;
  runId?: string;
  key?: string;
  timestamp?: string;
  legacy?: boolean;
  oidcToken?: string;
  attemptId?: string | null;
}): Request {
  const runId = input.runId ?? "run-123";
  const key = input.key ?? "runner-secret";
  const attemptId = input.attemptId === undefined ? executionAttemptId : (input.attemptId ?? undefined);
  const body = bindResultBody(input.body, attemptId);
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers = new Headers({ "content-type": "application/json" });

  if (input.oidcToken) {
    headers.set("authorization", `Bearer ${input.oidcToken}`);
  } else if (input.legacy) {
    headers.set("x-boardreadyops-runner-key", key);
  } else {
    headers.set("x-boardreadyops-runner-timestamp", timestamp);
    headers.set("x-boardreadyops-runner-signature", signature(key, timestamp, runId, attemptId, body));
  }

  const callbackUrl = new URL("https://boardreadyops.test/api/v1/runs/result");
  callbackUrl.searchParams.set("run_id", runId);
  if (attemptId) {
    callbackUrl.searchParams.set("attempt_id", attemptId);
  }

  return new Request(callbackUrl, {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  process.env.BOARDREADYOPS_RUNNER_RESULT_KEY = "runner-secret";
  delete process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE;
  delete process.env.BOARDREADYOPS_REQUIRE_GITHUB_OIDC;

  query.mockReset();
  createPullRequestCheckRun.mockClear();
  completeCheckRun.mockReset();
  createPullRequestComment.mockReset();
  verifyOidcToken.mockReset();
  verifyOidcToken.mockResolvedValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnvironment();
});

describe("readiness result route authentication and publication", () => {
  it("accepts a fresh body-bound signature and publishes check-run and PR output", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-123",
            github_check_run_id: 987,
            pull_request_number: 42,
            owner: "octo-org",
            name: "hardware-board",
            github_installation_id: 12345,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runId: "run-123",
      checkRunUpdated: true,
      pullRequestCommentCreated: true,
    });
    expect(completeCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 12345,
        repositoryOwner: "octo-org",
        repositoryName: "hardware-board",
        checkRunId: 987,
        runId: "run-123",
        conclusion: "success",
        completedAt: "2026-07-10T18:00:00.000Z",
      }),
    );
    expect(createPullRequestComment).toHaveBeenCalledWith(expect.objectContaining({ pullRequestNumber: 42 }));
  });

  it("computes the same terminal digest regardless of finding order", async () => {
    const firstBody = JSON.stringify({
      status: "completed",
      decision: "fail",
      findings: [
        { ruleId: "pcb.unrouted", severity: "error", message: "Two tracks remain unrouted." },
        { ruleId: "bom.missing-mpn", severity: "high", message: "Missing MPN." },
      ],
    });
    const secondBody = JSON.stringify({
      status: "completed",
      decision: "fail",
      findings: [
        { ruleId: "bom.missing-mpn", severity: "high", message: "Missing MPN." },
        { ruleId: "pcb.unrouted", severity: "error", message: "Two tracks remain unrouted." },
      ],
    });
    query.mockResolvedValue({ rows: [] });

    await handleResultRequest(resultRequest({ body: firstBody }), dependencies);
    await handleResultRequest(resultRequest({ body: secondBody }), dependencies);

    const firstParams = query.mock.calls[0]?.[1] as unknown[];
    const secondParams = query.mock.calls[1]?.[1] as unknown[];
    expect(firstParams[6]).toMatch(/^[0-9a-f]{64}$/u);
    expect(secondParams[6]).toBe(firstParams[6]);
  });

  it("persists the run result and replacement findings in one atomic statement", async () => {
    const body = JSON.stringify({
      status: "completed",
      decision: "fail",
      findings: [
        {
          ruleId: "bom.missing-mpn",
          severity: "high",
          message: "A production part is missing its MPN.",
          path: "board.kicad_sch",
        },
        {
          ruleId: "pcb.unrouted",
          severity: "error",
          message: "Two tracks remain unrouted.",
        },
      ],
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "run-123",
          github_check_run_id: null,
          pull_request_number: null,
          owner: "octo-org",
          name: "hardware-board",
          github_installation_id: 12345,
        },
      ],
    });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(202);
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("deleted_findings as");
    expect(sql).toContain("inserted_findings as");
    expect(sql).toContain("jsonb_to_recordset($6::jsonb)");
    expect(sql).toContain("coalesce(release_runs.completed_at");
    expect(sql).toContain("release_runs.terminal_result_digest");
    expect(sql).toMatch(/coalesce\(\s+release_runs\.duration_ms/u);
    expect(params.slice(0, 6)).toEqual([
      "run-123",
      executionAttemptId,
      "completed",
      "fail",
      "2026-07-10T18:00:00.000Z",
      JSON.stringify([
        {
          rule_id: "bom.missing-mpn",
          severity: "high",
          message: "A production part is missing its MPN.",
          path: "board.kicad_sch",
        },
        {
          rule_id: "pcb.unrouted",
          severity: "error",
          message: "Two tracks remain unrouted.",
          path: null,
        },
      ]),
    ]);
    expect(params[6]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rejects a superseded run without replacing findings or publishing stale GitHub output", async () => {
    const body = JSON.stringify({
      status: "completed",
      decision: "pass",
      findings: [{ ruleId: "release.ready", severity: "info", message: "The stale commit passed." }],
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          persistence_outcome: "superseded",
          id: "run-123",
          github_check_run_id: 987,
          pull_request_number: 42,
          owner: "octo-org",
          name: "hardware-board",
          github_installation_id: 12345,
          inserted_finding_count: 0,
        },
      ],
    });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "release run was superseded by a newer commit",
      runId: "run-123",
    });
    expect(query).toHaveBeenCalledOnce();
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("existing.status = 'superseded'");
    expect(completeCheckRun).not.toHaveBeenCalled();
    expect(createPullRequestComment).not.toHaveBeenCalled();
  });

  it("rejects a callback from an execution attempt that is no longer current", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    query.mockResolvedValueOnce({
      rows: [
        {
          persistence_outcome: "stale_attempt",
          id: "run-123",
          github_check_run_id: 987,
          pull_request_number: 42,
          owner: "octo-org",
          name: "hardware-board",
          github_installation_id: 12345,
        },
      ],
    });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "execution attempt is no longer current",
      runId: "run-123",
      executionAttemptId,
    });
    expect(completeCheckRun).not.toHaveBeenCalled();
    expect(createPullRequestComment).not.toHaveBeenCalled();
  });

  it("accepts an exact terminal replay and republishes GitHub output with the original completion time", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    query.mockResolvedValueOnce({
      rows: [
        {
          persistence_outcome: "replayed",
          id: "run-123",
          github_check_run_id: 987,
          pull_request_number: 42,
          owner: "octo-org",
          name: "hardware-board",
          github_installation_id: 12345,
          completed_at: "2026-07-10T17:58:00.000Z",
        },
      ],
    });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "replayed",
      runId: "run-123",
      executionAttemptId,
      checkRunUpdated: true,
    });
    expect(completeCheckRun).toHaveBeenCalledWith(expect.objectContaining({ completedAt: "2026-07-10T17:58:00.000Z" }));
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("existing.terminal_result_digest = $7");
    expect(sql).toContain("then 'replayed'");
  });

  it("rejects a conflicting terminal replay without changing GitHub output", async () => {
    const body = JSON.stringify({ status: "failed", decision: "error", findings: [] });
    query.mockResolvedValueOnce({
      rows: [
        {
          persistence_outcome: "conflicting_terminal_result",
          id: "run-123",
          github_check_run_id: 987,
          pull_request_number: 42,
          owner: "octo-org",
          name: "hardware-board",
          github_installation_id: 12345,
        },
      ],
    });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "terminal result conflicts with the persisted result",
      runId: "run-123",
      executionAttemptId,
    });
    expect(completeCheckRun).not.toHaveBeenCalled();
    expect(createPullRequestComment).not.toHaveBeenCalled();
  });

  it("rejects a body attempt that does not match the authenticated callback URL", async () => {
    const body = JSON.stringify({
      executionAttemptId: "b942dbea-fec5-4696-b645-68fd91d936ea",
      status: "completed",
      decision: "pass",
      findings: [],
    });

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "execution attempt does not match callback URL",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps attempt-less callbacks compatible only with legacy unassigned runs", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    query.mockResolvedValueOnce({
      rows: [
        {
          persistence_outcome: "accepted",
          id: "run-123",
          github_check_run_id: null,
          pull_request_number: null,
          owner: "octo-org",
          name: "hardware-board",
          github_installation_id: 12345,
          completed_at: "2026-07-10T18:00:00.000Z",
        },
      ],
    });

    const response = await handleResultRequest(resultRequest({ body, attemptId: null }), dependencies);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: "accepted", runId: "run-123" });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("existing.execution_attempt_id is distinct from $2");
    expect(params[1]).toBeNull();
  });

  it("accepts a run-bound GitHub OIDC token without a shared key", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    delete process.env.BOARDREADYOPS_RUNNER_RESULT_KEY;
    verifyOidcToken.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce({ rows: [] });

    const response = await handleResultRequest(
      resultRequest({ body, oidcToken: "header.payload.signature" }),
      dependencies,
    );

    expect(response.status).toBe(404);
    expect(verifyOidcToken).toHaveBeenCalledWith("header.payload.signature", "run-123", executionAttemptId);
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not downgrade an invalid bearer token to shared-key authentication", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    const request = resultRequest({ body });
    request.headers.set("authorization", "Bearer invalid.token.value");

    const response = await handleResultRequest(request, dependencies);

    expect(response.status).toBe(401);
    expect(verifyOidcToken).toHaveBeenCalledWith("invalid.token.value", "run-123", executionAttemptId);
    expect(query).not.toHaveBeenCalled();
  });

  it("accepts the result when the optional PR comment cannot be published", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-123",
            github_check_run_id: 987,
            pull_request_number: 42,
            owner: "octo-org",
            name: "hardware-board",
            github_installation_id: 12345,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    createPullRequestComment.mockRejectedValueOnce(
      new Error("GitHub pull request comment creation failed with status 403"),
    );

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      checkRunUpdated: true,
      pullRequestCommentCreated: false,
    });
    expect(completeCheckRun).toHaveBeenCalledOnce();
  });

  it("rejects stale signed callbacks before touching the database", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    const timestamp = String(Math.floor(Date.now() / 1000) - 601);

    const response = await handleResultRequest(resultRequest({ body, timestamp }), dependencies);

    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("authenticates the exact raw body before reporting malformed JSON", async () => {
    const response = await handleResultRequest(resultRequest({ body: "{not-json" }), dependencies);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid runner result JSON" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects shared-key callbacks when GitHub OIDC-only mode is enabled", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    process.env.BOARDREADYOPS_REQUIRE_GITHUB_OIDC = "1";

    const response = await handleResultRequest(resultRequest({ body }), dependencies);

    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    expect(verifyOidcToken).not.toHaveBeenCalled();
  });

  it("keeps legacy shared-key callbacks unless signed-only mode is enabled", async () => {
    const body = JSON.stringify({ status: "completed", decision: "pass", findings: [] });
    query.mockResolvedValueOnce({ rows: [] });

    const legacyResponse = await handleResultRequest(resultRequest({ body, legacy: true }), dependencies);
    expect(legacyResponse.status).toBe(404);

    process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE = "1";
    query.mockReset();
    const strictResponse = await handleResultRequest(resultRequest({ body, legacy: true }), dependencies);

    expect(strictResponse.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
