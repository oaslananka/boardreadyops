import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RunnerArtifactCapabilityRequest,
  RunnerClaimedJob,
  RunnerLeaseHeartbeatRequest,
  RunnerTerminalResultRequest,
} from "../../../packages/contracts/src/index.js";
import { executeRunnerPipeline } from "../../../src/cli/runner-pipeline.js";
import type { LoadedRunnerIdentity } from "../../../src/runner/identity.js";
import {
  type RunnerExecutionOutput,
  type RunnerWorkerClient,
  type RunnerWorkerDependencies,
  runRunnerWorkerOnce,
} from "../../../src/runner/worker.js";

const roots: string[] = [];
const keys = generateKeyPairSync("ed25519");
const runnerId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const leaseId = "44444444-4444-4444-8444-444444444444";
const artifactId = "55555555-5555-4555-8555-555555555555";

function claimedJob(sourceMode: RunnerClaimedJob["sourceMode"] = "customer_checkout"): RunnerClaimedJob {
  return {
    leaseId,
    leaseToken: "l".repeat(43),
    runId,
    executionAttemptId: attemptId,
    leaseExpiresAt: "2026-07-14T02:05:00.000Z",
    maximumLeaseExpiresAt: "2026-07-14T02:30:00.000Z",
    sourceMode,
    repository: {
      owner: "octo-org",
      name: "private-board",
      commitSha: "a".repeat(40),
      private: true,
    },
    safeMode: { enabled: true, reasons: ["private-repository"] },
  };
}

function identity(): LoadedRunnerIdentity {
  return {
    version: 1,
    controlPlaneUrl: "https://control.example",
    runnerId,
    workerClass: "self_hosted",
    privateKeyFile: "runner-private-key.pem",
    publicKeyFile: "runner-public-key.pem",
    capabilities: ["kicad:10", "linux-x64"],
    labels: ["customer-a"],
    activatedAt: "2026-07-14T02:00:00.000Z",
    identityFile: "/identity/runner.json",
    privateKeyPath: "/identity/runner-private-key.pem",
    publicKeyPath: "/identity/runner-public-key.pem",
  };
}

function client(job: RunnerClaimedJob | null = claimedJob()) {
  const claim = vi.fn(async () =>
    job
      ? ({ protocolVersion: 1, status: "claimed", job } as const)
      : ({ protocolVersion: 1, status: "empty", retryAfterSeconds: 17 } as const),
  );
  const heartbeat = vi.fn(async () => ({
    protocolVersion: 1 as const,
    status: "active" as const,
    leaseExpiresAt: "2026-07-14T02:05:00.000Z",
    maximumLeaseExpiresAt: "2026-07-14T02:30:00.000Z",
  }));
  const relinquish = vi.fn(async () => ({ protocolVersion: 1 as const, status: "accepted" as const }));
  const issueArtifactCapabilities = vi.fn(async () => ({
    protocolVersion: 1 as const,
    uploads: [
      {
        artifactId,
        storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
        uploadUrl: `https://control.example/api/v1/runner/artifacts/${artifactId}/upload?cap=${"u".repeat(43)}`,
        expiresAt: "2026-07-14T02:10:00.000Z",
        maximumBytes: 5,
      },
    ],
  }));
  const uploadArtifact = vi.fn(async () => undefined);
  const publishTerminalResult = vi.fn(async () => ({ ok: true }));
  const value: RunnerWorkerClient = {
    claim,
    heartbeat,
    relinquish,
    issueArtifactCapabilities,
    uploadArtifact,
    publishTerminalResult,
  };
  return {
    value,
    claim,
    heartbeat,
    relinquish,
    issueArtifactCapabilities,
    uploadArtifact,
    publishTerminalResult,
  };
}

function dependencies(clientValue: RunnerWorkerClient): Partial<RunnerWorkerDependencies> {
  return {
    loadIdentity: vi.fn(async () => identity()),
    loadPrivateKey: vi.fn(async () => keys.privateKey),
    createClient: vi.fn(() => clientValue),
    checkoutSource: vi.fn(),
    executePipeline: vi.fn(),
    removeWorkspace: vi.fn(async () => undefined),
    log: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runRunnerWorkerOnce", () => {
  it("returns an empty poll result without checking out source", async () => {
    const runnerClient = client(null);
    const overrides = dependencies(runnerClient.value);

    const result = await runRunnerWorkerOnce({ identityFile: "/identity/runner.json" }, overrides);

    expect(result).toEqual({ status: "empty", retryAfterSeconds: 17 });
    expect(overrides.checkoutSource).not.toHaveBeenCalled();
    expect(runnerClient.heartbeat).not.toHaveBeenCalled();
  });

  it("runs customer checkout, heartbeats, uploads declared artifacts, and publishes a terminal result", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-worker-"));
    roots.push(workspace);
    const artifactFile = path.join(workspace, "result.json");
    await writeFile(artifactFile, "hello", "utf8");
    const runnerClient = client();
    const overrides = dependencies(runnerClient.value);
    const checkoutSource = vi.fn(async () => workspace);
    const execution: RunnerExecutionOutput = {
      exitCode: 0,
      report: {
        summary: {
          total: 1,
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          info: 0,
        },
        findings: [
          {
            ruleId: "design.review",
            severity: "medium",
            message: "Review this design detail.",
            resource: { path: "board.kicad_pcb" },
          },
        ],
      },
      artifacts: [
        {
          kind: "report/json",
          name: "boardreadyops-result.json",
          role: "primary",
          filePath: artifactFile,
          bytes: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      ],
    };
    Object.assign(overrides, {
      checkoutSource,
      executePipeline: vi.fn(async () => execution),
    });

    const result = await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", workspaceRoot: "/workspaces", heartbeatSeconds: 30 },
      overrides,
    );

    expect(result).toEqual({ status: "completed", runId, executionAttemptId: attemptId, decision: "pass" });
    expect(checkoutSource).toHaveBeenCalledWith({
      job: claimedJob(),
      workspaceRoot: path.resolve("/workspaces"),
    });
    expect(
      (runnerClient.heartbeat.mock.calls as unknown as Array<[RunnerLeaseHeartbeatRequest]>).map(
        ([request]) => request.stage,
      ),
    ).toEqual(["preparing_source", "running", "uploading_artifacts", "reporting"]);
    expect(runnerClient.issueArtifactCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        executionAttemptId: attemptId,
        artifacts: [
          expect.objectContaining({
            bytes: 5,
            sha256: execution.artifacts[0]?.sha256,
          }),
        ],
      }),
    );
    expect(runnerClient.uploadArtifact).toHaveBeenCalledWith(
      expect.stringContaining(`/artifacts/${artifactId}/upload`),
      artifactFile,
      5,
    );
    const terminal = (
      runnerClient.publishTerminalResult.mock.calls as unknown as Array<[RunnerTerminalResultRequest]>
    )[0]?.[0];
    expect(terminal).toMatchObject({
      runId,
      executionAttemptId: attemptId,
      leaseId,
      result: {
        status: "completed",
        decision: "pass",
        artifacts: [
          {
            kind: "report/json",
            name: "boardreadyops-result.json",
            role: "primary",
            bytes: 5,
            sha256: execution.artifacts[0]?.sha256,
            storagePath: `${runId}/${attemptId}/${artifactId}.bin`,
          },
        ],
        findings: [{ ruleId: "design.review", severity: "medium", path: "board.kicad_pcb" }],
      },
    });
    expect(overrides.removeWorkspace).toHaveBeenCalledWith(workspace);
    expect(runnerClient.relinquish).not.toHaveBeenCalled();
  });

  it("executes the real BoardReadyOps pipeline and publishes generated reports without a source archive", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-real-pipeline-"));
    roots.push(workspace);
    await cp(path.resolve("tests/fixtures/projects/safe-basic"), workspace, { recursive: true });
    const runnerClient = client();
    const issueArtifactCapabilities = vi.fn(async (request: RunnerArtifactCapabilityRequest) => ({
      protocolVersion: 1 as const,
      uploads: request.artifacts.map((artifact, index) => ({
        artifactId: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
        storagePath: `${runId}/${attemptId}/report-${index}.bin`,
        uploadUrl: `https://control.example/upload/${index}?cap=${"u".repeat(43)}`,
        expiresAt: "2026-07-14T02:10:00.000Z",
        maximumBytes: artifact.bytes,
      })),
    }));
    runnerClient.value.issueArtifactCapabilities = issueArtifactCapabilities;
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: executeRunnerPipeline,
    });

    const result = await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", keepWorkspace: true, requireKicad: false },
      overrides,
    );

    expect(result).toMatchObject({ status: "completed", decision: "pass" });
    expect(runnerClient.uploadArtifact).toHaveBeenCalledTimes(3);
    const terminal = (
      runnerClient.publishTerminalResult.mock.calls as unknown as Array<[RunnerTerminalResultRequest]>
    )[0]?.[0];
    expect(terminal?.result.artifacts?.map((artifact) => artifact.kind)).toEqual([
      "report/json",
      "report/sarif",
      "report/markdown",
    ]);
    expect(terminal?.result.artifacts?.some((artifact) => artifact.kind.includes("source"))).toBe(false);
  });

  it("rejects broker source mode and relinquishes before checkout", async () => {
    const runnerClient = client(claimedJob("broker"));
    const overrides = dependencies(runnerClient.value);

    await expect(runRunnerWorkerOnce({ identityFile: "/identity/runner.json" }, overrides)).rejects.toThrow(
      /managed source boundary/u,
    );

    expect(overrides.checkoutSource).not.toHaveBeenCalled();
    expect(runnerClient.relinquish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "job_error",
        message: expect.stringContaining("non-customer checkout"),
      }),
    );
  });

  it("relinquishes and cleans the workspace after an execution failure", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-worker-"));
    roots.push(workspace);
    const runnerClient = client();
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(async () => {
        throw new Error("local analyzer failed");
      }),
    });

    await expect(runRunnerWorkerOnce({ identityFile: "/identity/runner.json" }, overrides)).rejects.toThrow(
      /local analyzer failed/u,
    );

    expect(runnerClient.relinquish).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "job_error", message: "local analyzer failed" }),
    );
    expect(overrides.removeWorkspace).toHaveBeenCalledWith(workspace);
    expect(runnerClient.publishTerminalResult).not.toHaveBeenCalled();
  });

  it("retains the workspace only when explicitly requested", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-worker-"));
    roots.push(workspace);
    const runnerClient = client();
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(async () => ({ exitCode: 0, artifacts: [] })),
    });

    await runRunnerWorkerOnce({ identityFile: "/identity/runner.json", keepWorkspace: true }, overrides);

    expect(overrides.removeWorkspace).not.toHaveBeenCalled();
  });
});
