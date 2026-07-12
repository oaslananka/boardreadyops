import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runnerProtocolHeaderNames } from "../../../apps/web/lib/runner-request-auth.js";
import {
  handleRunnerTerminalResultRequest,
  type RunnerTerminalResultRouteDependencies,
} from "../../../apps/web/lib/runner-terminal-result-routes.js";
import { signRunnerRequest } from "../../../packages/cloud-core/src/runner-request-signature.js";

const runnerId = "e81ec5a4-c6d0-4d87-a520-f7ab922ba183";
const runId = "5422e4e1-778f-4819-8314-fae19d8b9991";
const attemptId = "b31b614e-b656-491e-a6fa-59e13846bb0a";
const leaseId = "11e46ec0-2048-49c7-99e1-f77965218f0b";
const leaseToken = "jX6JYV8a2sYeH9N7wM4QkT0iC3rF5uL1pD8bG6zA9xE";
const nonce = "Q3fM0nP8wK6sR2vD9yL4bT7hX1cJ5aG0eN8uZ6iS2oA";
const now = new Date("2026-07-12T21:00:00.000Z");
const timestamp = Math.floor(now.valueOf() / 1000);
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

const query = vi.fn();
const authorize = vi.fn();
const persistVerifiedResult = vi.fn();
const verifyOidcToken = vi.fn(async () => false);

const resultRouteDependencies = {
  queryExecutor: () => ({ query }),
  checkRunClient: () => undefined,
  detailsUrl: () => undefined,
  now: () => now,
  verifyOidcToken,
};

const dependencies: RunnerTerminalResultRouteDependencies = {
  resultRouteDependencies,
  createAuthorizer: () => ({ authorize }),
  persistVerifiedResult,
  now: () => now,
};

function envelope(
  input: {
    status?: "completed" | "failed" | "running" | "timed_out";
    nestedAttemptId?: string;
    decision?: "error" | "fail" | "pass" | null;
  } = {},
): Record<string, unknown> {
  const status = input.status ?? "completed";
  return {
    protocolVersion: 1,
    runId,
    executionAttemptId: attemptId,
    leaseId,
    leaseToken,
    result: {
      executionAttemptId: input.nestedAttemptId ?? attemptId,
      status,
      decision: input.decision === undefined ? (status === "completed" ? "pass" : "error") : input.decision,
      findings: [],
    },
  };
}

function signedRequest(input: { body?: Record<string, unknown>; signedBody?: string; path?: string } = {}): Request {
  const path = input.path ?? "/api/v1/runner/results";
  const body = JSON.stringify(input.body ?? envelope());
  const signature = signRunnerRequest({
    method: "POST",
    path,
    timestamp,
    nonce,
    workerClass: "managed",
    runnerId,
    runId,
    executionAttemptId: attemptId,
    leaseId,
    body: input.signedBody ?? body,
    privateKey: keys.privateKey,
  });
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(runnerProtocolHeaderNames.protocolVersion, "1");
  headers.set(runnerProtocolHeaderNames.algorithm, "ed25519");
  headers.set(runnerProtocolHeaderNames.workerClass, "managed");
  headers.set(runnerProtocolHeaderNames.runnerId, runnerId);
  headers.set(runnerProtocolHeaderNames.timestamp, String(timestamp));
  headers.set(runnerProtocolHeaderNames.nonce, nonce);
  headers.set(runnerProtocolHeaderNames.signature, signature);
  return new Request(`https://boardreadyops.test${path}`, {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  query.mockReset();
  authorize.mockReset();
  persistVerifiedResult.mockReset();
  verifyOidcToken.mockReset();
  verifyOidcToken.mockResolvedValue(false);
  query.mockResolvedValue({ rows: [{ public_key: publicKey }] });
  authorize.mockResolvedValue({ status: "accepted" });
  persistVerifiedResult.mockResolvedValue(Response.json({ ok: true, status: "accepted" }, { status: 202 }));
});

describe("signed runner terminal-result route", () => {
  it("authorizes the raw signed envelope and forwards only the nested result to the verified persistence core", async () => {
    const request = signedRequest();
    const rawBody = await request.clone().text();
    const response = await handleRunnerTerminalResultRequest(request, dependencies);

    expect(response.status).toBe(202);
    expect(authorize).toHaveBeenCalledWith({
      workerClass: "managed",
      managedRunnerIdentityId: runnerId,
      requestTimestamp: timestamp,
      requestNonce: nonce,
      runId,
      executionAttemptId: attemptId,
      leaseId,
      leaseToken,
      requestBody: rawBody,
    });
    expect(persistVerifiedResult).toHaveBeenCalledTimes(1);
    const [internalRequest, internalDependencies] = persistVerifiedResult.mock.calls[0] as [
      Request,
      typeof resultRouteDependencies & { authenticationVerified: true; verifiedLeaseId: string },
    ];
    expect(new URL(internalRequest.url).searchParams.get("run_id")).toBe(runId);
    expect(new URL(internalRequest.url).searchParams.get("attempt_id")).toBe(attemptId);
    await expect(internalRequest.json()).resolves.toMatchObject({
      executionAttemptId: attemptId,
      status: "completed",
      decision: "pass",
      findings: [],
    });
    expect(internalDependencies.authenticationVerified).toBe(true);
    expect(internalDependencies.verifiedLeaseId).toBe(leaseId);
    expect(internalDependencies.queryExecutor()).toEqual({ query });
  });

  it("allows an exact authorization replay to retry persistence and publication", async () => {
    authorize.mockResolvedValue({ status: "replayed" });
    const response = await handleRunnerTerminalResultRequest(signedRequest(), dependencies);

    expect(response.status).toBe(202);
    expect(persistVerifiedResult).toHaveBeenCalledTimes(1);
  });

  it("rejects nonce reuse with another signed body before persistence", async () => {
    authorize.mockResolvedValue({ status: "conflicting_replay" });
    const response = await handleRunnerTerminalResultRequest(signedRequest(), dependencies);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "runner result nonce was reused with another payload",
    });
    expect(persistVerifiedResult).not.toHaveBeenCalled();
  });

  it("rejects a stale lease or execution attempt before persistence", async () => {
    authorize.mockResolvedValue({ status: "stale" });
    const response = await handleRunnerTerminalResultRequest(signedRequest(), dependencies);

    expect(response.status).toBe(409);
    expect(persistVerifiedResult).not.toHaveBeenCalled();
  });

  it("rejects raw-body tampering before terminal authorization", async () => {
    const original = JSON.stringify(envelope());
    const changed = envelope({ status: "failed" });
    const response = await handleRunnerTerminalResultRequest(
      signedRequest({ body: changed, signedBody: original }),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
    expect(persistVerifiedResult).not.toHaveBeenCalled();
  });

  it("rejects non-terminal statuses before verification-key lookup", async () => {
    const response = await handleRunnerTerminalResultRequest(
      signedRequest({ body: envelope({ status: "running", decision: null }) }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("rejects a nested result bound to another execution attempt", async () => {
    const response = await handleRunnerTerminalResultRequest(
      signedRequest({ body: envelope({ nestedAttemptId: "66cf780f-89ef-489d-b88a-f5a8fb739ebf" }) }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
});
