import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyRunnerRequestSignature } from "../../../packages/cloud-core/src/runner-request-signature.js";
import {
  activateRunner,
  normalizeControlPlaneUrl,
  RunnerControlPlaneClient,
  RunnerControlPlaneError,
} from "../../../src/runner/client.js";

const runnerId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const leaseId = "44444444-4444-4444-8444-444444444444";
const leaseToken = "l".repeat(43);
const nonce = "n".repeat(32);
const now = new Date("2026-07-14T02:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RunnerControlPlaneClient", () => {
  it("signs claim requests over the exact method, path, body, timestamp, and runner identity", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = String(init?.body ?? "");
      const timestamp = Number(headers.get("x-boardreadyops-runner-timestamp"));
      const signature = headers.get("x-boardreadyops-runner-signature") ?? "";
      expect(target.pathname).toBe("/api/v1/runner/jobs/claim");
      expect(headers.get("x-boardreadyops-runner-worker-class")).toBe("self_hosted");
      expect(headers.get("x-boardreadyops-runner-id")).toBe(runnerId);
      expect(
        verifyRunnerRequestSignature({
          method: "POST",
          path: target.pathname,
          timestamp,
          nonce,
          workerClass: "self_hosted",
          runnerId,
          body,
          publicKey: keys.publicKey,
          signature,
        }),
      ).toBe(true);
      expect(JSON.parse(body)).toEqual({
        protocolVersion: 1,
        workerClass: "self_hosted",
        capabilities: ["kicad:10"],
        labels: ["linux-x64"],
      });
      return Response.json({
        protocolVersion: 1,
        status: "claimed",
        job: {
          leaseId,
          leaseToken,
          runId,
          executionAttemptId: attemptId,
          leaseExpiresAt: "2026-07-14T02:05:00.000Z",
          maximumLeaseExpiresAt: "2026-07-14T02:30:00.000Z",
          sourceMode: "customer_checkout",
          repository: {
            owner: "octo-org",
            name: "private-board",
            commitSha: "a".repeat(40),
            private: true,
          },
          safeMode: { enabled: true, reasons: ["private-repository"] },
        },
      });
    });
    const client = new RunnerControlPlaneClient({
      baseUrl: "https://control.example",
      runnerId,
      privateKey: keys.privateKey,
      fetch: fetchMock as typeof fetch,
      now: () => now,
      nonce: () => nonce,
    });

    const response = await client.claim({
      protocolVersion: 1,
      workerClass: "self_hosted",
      capabilities: ["kicad:10"],
      labels: ["linux-x64"],
    });

    expect(response.status).toBe("claimed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("binds lease context into heartbeat signatures", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = String(init?.body ?? "");
      expect(
        verifyRunnerRequestSignature({
          method: "POST",
          path: target.pathname,
          timestamp: Number(headers.get("x-boardreadyops-runner-timestamp")),
          nonce,
          workerClass: "self_hosted",
          runnerId,
          runId,
          executionAttemptId: attemptId,
          leaseId,
          body,
          publicKey: keys.publicKey,
          signature: headers.get("x-boardreadyops-runner-signature") ?? "",
        }),
      ).toBe(true);
      return Response.json({
        protocolVersion: 1,
        status: "active",
        leaseExpiresAt: "2026-07-14T02:05:00.000Z",
        maximumLeaseExpiresAt: "2026-07-14T02:30:00.000Z",
      });
    });
    const client = new RunnerControlPlaneClient({
      baseUrl: "https://control.example",
      runnerId,
      privateKey: keys.privateKey,
      fetch: fetchMock as typeof fetch,
      now: () => now,
      nonce: () => nonce,
    });

    await expect(
      client.heartbeat({
        protocolVersion: 1,
        runId,
        executionAttemptId: attemptId,
        leaseId,
        leaseToken,
        stage: "running",
      }),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("activates with an enrollment token without adding runner signature headers", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("x-boardreadyops-runner-signature")).toBe(false);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        protocolVersion: 1,
        enrollmentToken: "e".repeat(43),
        algorithm: "ed25519",
        capabilities: ["kicad:10"],
      });
      return Response.json({ protocolVersion: 1, status: "activated", registrationId: runnerId });
    });

    await expect(
      activateRunner({
        baseUrl: "https://control.example",
        enrollmentToken: "e".repeat(43),
        publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
        capabilities: ["kicad:10"],
        fetch: fetchMock as typeof fetch,
      }),
    ).resolves.toEqual({ protocolVersion: 1, status: "activated", registrationId: runnerId });
  });

  it("rejects insecure non-loopback control-plane origins", () => {
    expect(() => normalizeControlPlaneUrl("http://control.example")).toThrow(/must use HTTPS/u);
    expect(normalizeControlPlaneUrl("http://127.0.0.1:3000").origin).toBe("http://127.0.0.1:3000");
  });

  it("does not upload an artifact whose size changed after capability issuance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-client-"));
    roots.push(root);
    const artifact = path.join(root, "report.json");
    await writeFile(artifact, "changed", "utf8");
    const fetchMock = vi.fn();
    const client = new RunnerControlPlaneClient({
      baseUrl: "https://control.example",
      runnerId,
      privateKey: keys.privateKey,
      fetch: fetchMock as typeof fetch,
    });

    await expect(client.uploadArtifact("https://control.example/upload?cap=x", artifact, 5)).rejects.toThrow(
      /artifact size changed/u,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns bounded HTTP failure metadata without exposing it through the message", async () => {
    const client = new RunnerControlPlaneClient({
      baseUrl: "https://control.example",
      runnerId,
      privateKey: keys.privateKey,
      fetch: vi.fn(async () => new Response('{"error":"denied"}', { status: 401 })) as typeof fetch,
    });

    const error = await client
      .claim({ protocolVersion: 1, workerClass: "self_hosted", capabilities: [], labels: [] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RunnerControlPlaneError);
    expect((error as RunnerControlPlaneError).status).toBe(401);
    expect((error as RunnerControlPlaneError).message).not.toContain("denied");
  });
});
