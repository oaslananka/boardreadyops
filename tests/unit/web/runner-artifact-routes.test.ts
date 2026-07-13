import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleRunnerArtifactCapabilityRequest,
  handleRunnerArtifactUploadRequest,
  type RunnerArtifactRouteDependencies,
} from "../../../apps/web/lib/runner-artifact-routes.js";
import { runnerProtocolHeaderNames } from "../../../apps/web/lib/runner-request-auth.js";
import { signRunnerRequest } from "../../../packages/cloud-core/src/runner-request-signature.js";

const runnerId = "e81ec5a4-c6d0-4d87-a520-f7ab922ba183";
const runId = "5422e4e1-778f-4819-8314-fae19d8b9991";
const attemptId = "b31b614e-b656-491e-a6fa-59e13846bb0a";
const leaseId = "11e46ec0-2048-49c7-99e1-f77965218f0b";
const artifactId = "b7430a5f-1228-4eb2-95dd-fd5b57f8f4ca";
const leaseToken = "jX6JYV8a2sYeH9N7wM4QkT0iC3rF5uL1pD8bG6zA9xE";
const uploadToken = "Q3fM0nP8wK6sR2vD9yL4bT7hX1cJ5aG0eN8uZ6iS2oA";
const nonce = "Z8cL1mR4qP7yT0vN3hK6sD9xF2bJ5aG8eW1uI4oC7rM";
const now = new Date("2026-07-12T20:00:00.000Z");
const timestamp = Math.floor(now.valueOf() / 1000);
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

const query = vi.fn();
const issueCapabilities = vi.fn();
const beginUpload = vi.fn();
const completeUpload = vi.fn();
const failUpload = vi.fn();
const store = { issueCapabilities, beginUpload, completeUpload, failUpload };
let storageRoot: string | undefined;

function requireStorageRoot(): string {
  if (!storageRoot) throw new Error("storage root is not initialized");
  return storageRoot;
}

function dependencies(environment: Readonly<Record<string, string | undefined>>): RunnerArtifactRouteDependencies {
  return {
    environment,
    queryExecutor: () => ({ query }),
    createArtifactStore: () => store,
    now: () => now,
  };
}

function capabilityBody(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    runId,
    executionAttemptId: attemptId,
    leaseId,
    leaseToken,
    artifacts: [
      {
        kind: "report",
        name: "report.json",
        role: "machine",
        bytes: 5,
        sha256: createHash("sha256").update("hello").digest("hex"),
      },
    ],
  };
}

function signedCapabilityRequest(body: Record<string, unknown> = capabilityBody()): Request {
  const text = JSON.stringify(body);
  const requestPath = "/api/v1/runner/artifacts/capabilities";
  const signature = signRunnerRequest({
    method: "POST",
    path: requestPath,
    timestamp,
    nonce,
    workerClass: "managed",
    runnerId,
    runId,
    executionAttemptId: attemptId,
    leaseId,
    body: text,
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
  return new Request(`https://boardreadyops.test${requestPath}`, {
    method: "POST",
    headers,
    body: text,
  });
}

function uploadRequest(content: string, headers: Record<string, string> = {}): Request {
  return new Request(
    `https://boardreadyops.test/api/v1/runner/artifacts/${artifactId}/upload?cap=${encodeURIComponent(uploadToken)}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(Buffer.byteLength(content)),
        ...headers,
      },
      body: content,
    },
  );
}

beforeEach(async () => {
  query.mockReset();
  issueCapabilities.mockReset();
  beginUpload.mockReset();
  completeUpload.mockReset();
  failUpload.mockReset();
  query.mockResolvedValue({ rows: [{ public_key: publicKey }] });
  storageRoot = await mkdtemp(path.join(tmpdir(), "boardreadyops-artifact-route-"));
});

afterEach(async () => {
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  storageRoot = undefined;
});

describe("runner artifact transport routes", () => {
  it("returns signed HTTPS upload capabilities bound to the authenticated lease", async () => {
    issueCapabilities.mockResolvedValue({
      status: "accepted",
      uploads: [
        {
          artifactId,
          storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
          uploadToken,
          expiresAt: "2026-07-12T20:02:00.000Z",
          maximumBytes: 5,
        },
      ],
    });

    const response = await handleRunnerArtifactCapabilityRequest(
      signedCapabilityRequest(),
      dependencies({ BOARDREADYOPS_PUBLIC_URL: "https://cloud.boardreadyops.example" }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      protocolVersion: 1,
      uploads: [
        {
          artifactId,
          storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
          uploadUrl: `https://cloud.boardreadyops.example/api/v1/runner/artifacts/${artifactId}/upload?cap=${uploadToken}`,
          expiresAt: "2026-07-12T20:02:00.000Z",
          maximumBytes: 5,
        },
      ],
    });
    expect(issueCapabilities).toHaveBeenCalledWith({
      workerClass: "managed",
      managedRunnerIdentityId: runnerId,
      requestTimestamp: timestamp,
      requestNonce: nonce,
      runId,
      executionAttemptId: attemptId,
      leaseId,
      leaseToken,
      artifacts: capabilityBody().artifacts,
    });
  });

  it("rejects non-HTTPS public configuration before issuing capabilities", async () => {
    const response = await handleRunnerArtifactCapabilityRequest(
      signedCapabilityRequest(),
      dependencies({ BOARDREADYOPS_PUBLIC_URL: "http://boardreadyops.internal" }),
    );

    expect(response.status).toBe(503);
    expect(issueCapabilities).not.toHaveBeenCalled();
  });

  it("rejects lease-context tampering before capability issuance", async () => {
    const body = { ...capabilityBody(), runId: "f57a87c5-70f4-4b18-9d4c-358ef77b1e43" };
    const response = await handleRunnerArtifactCapabilityRequest(
      signedCapabilityRequest(body),
      dependencies({ BOARDREADYOPS_PUBLIC_URL: "https://cloud.boardreadyops.example" }),
    );

    expect(response.status).toBe(401);
    expect(issueCapabilities).not.toHaveBeenCalled();
  });

  it("streams an exact artifact to the server-generated local path and persists metadata", async () => {
    const content = "hello";
    const sha256 = createHash("sha256").update(content).digest("hex");
    beginUpload.mockResolvedValue({
      status: "accepted",
      artifactId,
      runId,
      executionAttemptId: attemptId,
      leaseId,
      storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
      declaredBytes: 5,
      expectedSha256: sha256,
    });
    completeUpload.mockResolvedValue({ status: "accepted" });

    const response = await handleRunnerArtifactUploadRequest(
      uploadRequest(content),
      artifactId,
      dependencies({ ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      protocolVersion: 1,
      status: "accepted",
      artifactId,
      bytes: 5,
      sha256,
    });
    const finalPath = path.join(requireStorageRoot(), runId, attemptId, `${artifactId}.bin`);
    await expect(readFile(finalPath, "utf8")).resolves.toBe(content);
    expect(completeUpload).toHaveBeenCalledWith({ artifactId, uploadToken, sha256, bytes: 5 });
    expect(failUpload).not.toHaveBeenCalled();
  });

  it("consumes and fails an oversized upload without leaving a file", async () => {
    beginUpload.mockResolvedValue({
      status: "accepted",
      artifactId,
      runId,
      executionAttemptId: attemptId,
      leaseId,
      storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
      declaredBytes: 3,
    });

    const response = await handleRunnerArtifactUploadRequest(
      uploadRequest("four"),
      artifactId,
      dependencies({ ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot }),
    );

    expect(response.status).toBe(413);
    expect(failUpload).toHaveBeenCalledWith({
      artifactId,
      uploadToken,
      reason: "artifact payload exceeds its declared size",
    });
    const finalPath = path.join(requireStorageRoot(), runId, attemptId, `${artifactId}.bin`);
    await expect(readFile(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(completeUpload).not.toHaveBeenCalled();
  });

  it("rejects a SHA mismatch and removes the temporary upload", async () => {
    beginUpload.mockResolvedValue({
      status: "accepted",
      artifactId,
      runId,
      executionAttemptId: attemptId,
      leaseId,
      storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
      declaredBytes: 5,
      expectedSha256: createHash("sha256").update("other").digest("hex"),
    });

    const response = await handleRunnerArtifactUploadRequest(
      uploadRequest("hello"),
      artifactId,
      dependencies({ ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot }),
    );

    expect(response.status).toBe(409);
    expect(failUpload).toHaveBeenCalledWith({
      artifactId,
      uploadToken,
      reason: "Artifact SHA-256 does not match its declaration.",
    });
    const finalPath = path.join(requireStorageRoot(), runId, attemptId, `${artifactId}.bin`);
    await expect(readFile(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects reuse before reading or writing a second request body", async () => {
    beginUpload.mockResolvedValue({ status: "replayed" });
    const response = await handleRunnerArtifactUploadRequest(
      uploadRequest("hello"),
      artifactId,
      dependencies({ ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: storageRoot }),
    );

    expect(response.status).toBe(409);
    expect(completeUpload).not.toHaveBeenCalled();
    expect(failUpload).not.toHaveBeenCalled();
  });
});
