import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleRunnerClaimRequest,
  handleRunnerHeartbeatRequest,
  handleRunnerRelinquishRequest,
  type RunnerLeaseRouteDependencies,
} from "../../../apps/web/lib/runner-lease-routes.js";
import { runnerProtocolHeaderNames } from "../../../apps/web/lib/runner-request-auth.js";
import { signRunnerRequest } from "../../../packages/cloud-core/src/runner-request-signature.js";

const managedRunnerId = "e81ec5a4-c6d0-4d87-a520-f7ab922ba183";
const selfHostedRunnerId = "2cbe8033-9e45-4e3e-83c7-d680fd2f7b35";
const runId = "5422e4e1-778f-4819-8314-fae19d8b9991";
const attemptId = "b31b614e-b656-491e-a6fa-59e13846bb0a";
const leaseId = "11e46ec0-2048-49c7-99e1-f77965218f0b";
const leaseToken = "jX6JYV8a2sYeH9N7wM4QkT0iC3rF5uL1pD8bG6zA9xE";
const nonce = "Q3fM0nP8wK6sR2vD9yL4bT7hX1cJ5aG0eN8uZ6iS2oA";
const now = new Date("2026-07-12T18:30:00.000Z");
const timestamp = Math.floor(now.valueOf() / 1000);
const managedKeys = generateKeyPairSync("ed25519");
const selfHostedKeys = generateKeyPairSync("ed25519");
const managedPublicKey = managedKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const selfHostedPublicKey = selfHostedKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

const query = vi.fn();
const claimJob = vi.fn();
const heartbeat = vi.fn();
const relinquish = vi.fn();
const expireLeases = vi.fn();
const store = { claimJob, heartbeat, relinquish, expireLeases };

const dependencies: RunnerLeaseRouteDependencies = {
  queryExecutor: () => ({ query }),
  createLeaseStore: () => store,
  now: () => now,
};

type SignedRequestInput = {
  path: string;
  body: Record<string, unknown>;
  workerClass?: "managed" | "self_hosted";
  runnerId?: string;
  requestTimestamp?: number;
  signedBody?: string;
  context?: {
    runId?: string;
    executionAttemptId?: string;
    leaseId?: string;
  };
};

function signedRequest(input: SignedRequestInput): Request {
  const workerClass = input.workerClass ?? "managed";
  const runnerId = input.runnerId ?? (workerClass === "managed" ? managedRunnerId : selfHostedRunnerId);
  const requestTimestamp = input.requestTimestamp ?? timestamp;
  const body = JSON.stringify(input.body);
  const signedBody = input.signedBody ?? body;
  const privateKey = workerClass === "managed" ? managedKeys.privateKey : selfHostedKeys.privateKey;
  const signature = signRunnerRequest({
    method: "POST",
    path: input.path,
    timestamp: requestTimestamp,
    nonce,
    workerClass,
    runnerId,
    body: signedBody,
    privateKey,
    ...(input.context?.runId === undefined ? {} : { runId: input.context.runId }),
    ...(input.context?.executionAttemptId === undefined
      ? {}
      : { executionAttemptId: input.context.executionAttemptId }),
    ...(input.context?.leaseId === undefined ? {} : { leaseId: input.context.leaseId }),
  });
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(runnerProtocolHeaderNames.protocolVersion, "1");
  headers.set(runnerProtocolHeaderNames.algorithm, "ed25519");
  headers.set(runnerProtocolHeaderNames.workerClass, workerClass);
  headers.set(runnerProtocolHeaderNames.runnerId, runnerId);
  headers.set(runnerProtocolHeaderNames.timestamp, String(requestTimestamp));
  headers.set(runnerProtocolHeaderNames.nonce, nonce);
  headers.set(runnerProtocolHeaderNames.signature, signature);
  return new Request(`https://boardreadyops.test${input.path}`, {
    method: "POST",
    headers,
    body,
  });
}

function claimBody(workerClass: "managed" | "self_hosted" = "managed"): Record<string, unknown> {
  return {
    protocolVersion: 1,
    workerClass,
    capabilities: ["kicad:10"],
    labels: ["linux-x64"],
  };
}

function heartbeatBody(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    runId,
    executionAttemptId: attemptId,
    leaseId,
    leaseToken,
    stage: "running",
    progressPercent: 40,
  };
}

function relinquishBody(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    runId,
    executionAttemptId: attemptId,
    leaseId,
    leaseToken,
    reason: "shutdown",
    message: "Host is shutting down.",
  };
}

beforeEach(() => {
  query.mockReset();
  claimJob.mockReset();
  heartbeat.mockReset();
  relinquish.mockReset();
  expireLeases.mockReset();
  query.mockImplementation(async (sql: string) => ({
    rows: [{ public_key: sql.includes("managed_runner_identities") ? managedPublicKey : selfHostedPublicKey }],
  }));
});

describe("signed runner lease routes", () => {
  it("authenticates and claims without accepting caller-selected tenant or run state", async () => {
    claimJob.mockResolvedValue({
      status: "claimed",
      leaseId,
      leaseToken,
      runId,
      executionAttemptId: attemptId,
      leaseExpiresAt: "2026-07-12T18:32:00.000Z",
      maximumLeaseExpiresAt: "2026-07-12T19:00:00.000Z",
      sourceMode: "broker",
      repository: {
        owner: "octo-org",
        name: "hardware-board",
        commitSha: "a".repeat(40),
        private: true,
      },
      safeMode: { enabled: true, reasons: ["private-repository"] },
    });

    const response = await handleRunnerClaimRequest(
      signedRequest({ path: "/api/v1/runner/jobs/claim", body: claimBody() }),
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      protocolVersion: 1,
      status: "claimed",
      job: { leaseId, runId, executionAttemptId: attemptId },
    });
    expect(claimJob).toHaveBeenCalledWith({
      workerClass: "managed",
      managedRunnerIdentityId: managedRunnerId,
      requestTimestamp: timestamp,
      requestNonce: nonce,
      capabilities: ["kicad:10", "linux-x64"],
    });
    expect(query.mock.calls[0]?.[0]).toContain("managed_runner_identities");
  });

  it("rejects strict claim fields before identity lookup", async () => {
    const body = { ...claimBody(), installationId: "tenant-controlled", runId };
    const response = await handleRunnerClaimRequest(
      signedRequest({ path: "/api/v1/runner/jobs/claim", body }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("rejects a body changed after signing", async () => {
    const signedBody = JSON.stringify(claimBody());
    const changedBody = { ...claimBody(), capabilities: ["kicad:10", "secret:tenant"] };
    const response = await handleRunnerClaimRequest(
      signedRequest({ path: "/api/v1/runner/jobs/claim", body: changedBody, signedBody }),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("rejects stale signatures before verification-key lookup", async () => {
    const response = await handleRunnerClaimRequest(
      signedRequest({
        path: "/api/v1/runner/jobs/claim",
        body: claimBody(),
        requestTimestamp: timestamp - 301,
      }),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects inactive or unknown runner identities", async () => {
    query.mockResolvedValue({ rows: [] });
    const response = await handleRunnerClaimRequest(
      signedRequest({ path: "/api/v1/runner/jobs/claim", body: claimBody() }),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("rejects a signed worker class that conflicts with the claim body", async () => {
    const response = await handleRunnerClaimRequest(
      signedRequest({
        path: "/api/v1/runner/jobs/claim",
        body: claimBody("self_hosted"),
        workerClass: "managed",
      }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("binds heartbeat signatures to the exact run, attempt, and lease", async () => {
    heartbeat.mockResolvedValue({
      status: "active",
      leaseExpiresAt: "2026-07-12T18:32:30.000Z",
      maximumLeaseExpiresAt: "2026-07-12T19:00:00.000Z",
    });
    const body = heartbeatBody();
    const response = await handleRunnerHeartbeatRequest(
      signedRequest({
        path: "/api/v1/runner/leases/heartbeat",
        body,
        workerClass: "self_hosted",
        context: { runId, executionAttemptId: attemptId, leaseId },
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      protocolVersion: 1,
      status: "active",
      leaseExpiresAt: "2026-07-12T18:32:30.000Z",
      maximumLeaseExpiresAt: "2026-07-12T19:00:00.000Z",
    });
    expect(heartbeat).toHaveBeenCalledWith({
      workerClass: "self_hosted",
      runnerRegistrationId: selfHostedRunnerId,
      requestTimestamp: timestamp,
      requestNonce: nonce,
      runId,
      executionAttemptId: attemptId,
      leaseId,
      leaseToken,
      stage: "running",
      progressPercent: 40,
    });
  });

  it("rejects heartbeat context tampering", async () => {
    const originalBody = JSON.stringify(heartbeatBody());
    const changedRunId = "66cf780f-89ef-489d-b88a-f5a8fb739ebf";
    const changedBody = { ...heartbeatBody(), runId: changedRunId };
    const response = await handleRunnerHeartbeatRequest(
      signedRequest({
        path: "/api/v1/runner/leases/heartbeat",
        body: changedBody,
        signedBody: originalBody,
        context: { runId, executionAttemptId: attemptId, leaseId },
      }),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("fails a replayed heartbeat closed", async () => {
    heartbeat.mockResolvedValue({ status: "replayed" });
    const response = await handleRunnerHeartbeatRequest(
      signedRequest({
        path: "/api/v1/runner/leases/heartbeat",
        body: heartbeatBody(),
        context: { runId, executionAttemptId: attemptId, leaseId },
      }),
      dependencies,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "runner heartbeat request was replayed" });
  });

  it("returns idempotent relinquish outcomes without exposing lease state", async () => {
    relinquish.mockResolvedValue({ status: "replayed" });
    const response = await handleRunnerRelinquishRequest(
      signedRequest({
        path: "/api/v1/runner/leases/relinquish",
        body: relinquishBody(),
        context: { runId, executionAttemptId: attemptId, leaseId },
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ protocolVersion: 1, status: "replayed" });
    expect(relinquish).toHaveBeenCalledWith(
      expect.objectContaining({
        workerClass: "managed",
        managedRunnerIdentityId: managedRunnerId,
        runId,
        executionAttemptId: attemptId,
        leaseId,
        reason: "shutdown",
      }),
    );
  });
});
