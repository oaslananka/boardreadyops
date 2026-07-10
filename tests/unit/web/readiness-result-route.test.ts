import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../../apps/web/app/api/v1/runs/result/route.js";

const query = vi.fn();
const createPullRequestCheckRun = vi.fn(async () => ({ id: 1 }));
const completeCheckRun = vi.fn();
const createPullRequestComment = vi.fn();

const dependencies: ResultRouteDependencies = {
  queryExecutor: () => ({ query }),
  checkRunClient: () => ({ createPullRequestCheckRun, completeCheckRun, createPullRequestComment }),
  detailsUrl: (runId) => `https://boardreadyops.test/runs/${encodeURIComponent(runId)}`,
  now: () => new Date("2026-07-10T18:00:00.000Z"),
};

const originalEnvironment = {
  resultKey: process.env.BOARDREADYOPS_RUNNER_RESULT_KEY,
  requireSignature: process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE,
};

function restoreEnvironment(): void {
  const values: Array<[string, string | undefined]> = [
    ["BOARDREADYOPS_RUNNER_RESULT_KEY", originalEnvironment.resultKey],
    ["BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE", originalEnvironment.requireSignature],
  ];

  for (const [name, value] of values) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function signature(key: string, timestamp: string, runId: string, body: string): string {
  return `sha256=${createHmac("sha256", key).update(`${timestamp}.${runId}.${body}`).digest("hex")}`;
}

function resultRequest(input: {
  body: string;
  runId?: string;
  key?: string;
  timestamp?: string;
  legacy?: boolean;
}): Request {
  const runId = input.runId ?? "run-123";
  const key = input.key ?? "runner-secret";
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers = new Headers({ "content-type": "application/json" });

  if (input.legacy) {
    headers.set("x-boardreadyops-runner-key", key);
  } else {
    headers.set("x-boardreadyops-runner-timestamp", timestamp);
    headers.set("x-boardreadyops-runner-signature", signature(key, timestamp, runId, input.body));
  }

  return new Request(`https://boardreadyops.test/api/v1/runs/result?run_id=${encodeURIComponent(runId)}`, {
    method: "POST",
    headers,
    body: input.body,
  });
}

beforeEach(() => {
  process.env.BOARDREADYOPS_RUNNER_RESULT_KEY = "runner-secret";
  delete process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE;

  query.mockReset();
  createPullRequestCheckRun.mockClear();
  completeCheckRun.mockReset();
  createPullRequestComment.mockReset();
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
