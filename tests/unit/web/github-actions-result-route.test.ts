import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryExecutor: vi.fn(),
  handleResultRequest: vi.fn(),
  resultOidcExpectations: vi.fn(),
  verifyGitHubActionsOidcToken: vi.fn(),
}));

vi.mock("../../../apps/web/app/api/v1/runs/result/route.js", () => ({
  defaultResultRouteDependencies: {
    queryExecutor: mocks.queryExecutor,
    checkRunClient: vi.fn(),
    detailsUrl: vi.fn(),
    now: vi.fn(),
    verifyOidcToken: vi.fn(),
  },
  handleResultRequest: mocks.handleResultRequest,
}));

vi.mock("../../../apps/web/lib/result-oidc-expectations.js", () => ({
  resultOidcExpectations: mocks.resultOidcExpectations,
}));

vi.mock("../../../apps/web/lib/github-actions-oidc.js", () => ({
  verifyGitHubActionsOidcToken: mocks.verifyGitHubActionsOidcToken,
}));

import { POST } from "../../../apps/web/app/api/v1/runs/github-actions-result/route.js";

const runId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const executionAttemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
const expectations = {
  runId,
  executionAttemptId,
  repository: "octo-org/hardware-board",
  repositoryId: "98765",
  workflowRef: "octo-org/hardware-board/.github/workflows/readiness-runner.yml@refs/heads/main",
  ref: "refs/heads/main",
};
const executor = { query: vi.fn() };

function request(input: { runId?: string; attemptId?: string; token?: string } = {}): Request {
  const url = new URL("https://boardreadyops.test/api/v1/runs/github-actions-result");
  url.searchParams.set("run_id", input.runId ?? runId);
  url.searchParams.set("attempt_id", input.attemptId ?? executionAttemptId);
  const headers = new Headers({ "content-type": "application/json" });
  if (input.token !== "") headers.set("authorization", `Bearer ${input.token ?? "header.payload.signature"}`);
  return new Request(url, { method: "POST", headers, body: "{}" });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.queryExecutor.mockReturnValue(executor);
  mocks.resultOidcExpectations.mockResolvedValue(expectations);
  mocks.verifyGitHubActionsOidcToken.mockResolvedValue(true);
  mocks.handleResultRequest.mockResolvedValue(Response.json({ ok: true }, { status: 202 }));
});

describe("GitHub Actions result route", () => {
  it("requires run and execution-attempt UUIDs", async () => {
    const response = await POST(request({ runId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(mocks.queryExecutor).not.toHaveBeenCalled();
  });

  it("requires a bearer token", async () => {
    const response = await POST(request({ token: "" }));
    expect(response.status).toBe(401);
    expect(mocks.queryExecutor).not.toHaveBeenCalled();
  });

  it("fails closed when the database is unavailable", async () => {
    mocks.queryExecutor.mockReturnValue(undefined);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.resultOidcExpectations).not.toHaveBeenCalled();
  });

  it("returns a retriable failure when the authentication lookup fails", async () => {
    mocks.resultOidcExpectations.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.verifyGitHubActionsOidcToken).not.toHaveBeenCalled();
    expect(mocks.handleResultRequest).not.toHaveBeenCalled();
  });

  it("rejects an unknown run or invalid OIDC token", async () => {
    mocks.resultOidcExpectations.mockResolvedValueOnce(undefined);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.verifyGitHubActionsOidcToken).not.toHaveBeenCalled();

    mocks.resultOidcExpectations.mockResolvedValueOnce(expectations);
    mocks.verifyGitHubActionsOidcToken.mockResolvedValueOnce(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.handleResultRequest).not.toHaveBeenCalled();
  });

  it("delegates an authenticated callback to the existing result persistence route", async () => {
    const incoming = request();
    const response = await POST(incoming);

    expect(response.status).toBe(202);
    expect(mocks.resultOidcExpectations).toHaveBeenCalledWith(executor, runId, executionAttemptId);
    expect(mocks.verifyGitHubActionsOidcToken).toHaveBeenCalledWith("header.payload.signature", expectations);
    expect(mocks.handleResultRequest).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        authenticationVerified: true,
        queryExecutor: expect.any(Function),
      }),
    );
    const delegatedDependencies = mocks.handleResultRequest.mock.calls[0]?.[1];
    expect(delegatedDependencies?.queryExecutor()).toBe(executor);
  });
});
