import { generateKeyPairSync } from "node:crypto";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  serveRunnerWorker,
} from "../../../src/runner/worker.js";

const roots: string[] = [];
const keys = generateKeyPairSync("ed25519");
const runnerId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const leaseId = "44444444-4444-4444-8444-444444444444";
const artifactId = "55555555-5555-4555-8555-555555555555";

function claimedJob(
  sourceMode: RunnerClaimedJob["sourceMode"] = "customer_checkout",
  safeMode: RunnerClaimedJob["safeMode"] = { enabled: false, reasons: [] },
): RunnerClaimedJob {
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
      name: "hardware-board",
      commitSha: "a".repeat(40),
      private: false,
    },
    safeMode,
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runRunnerWorkerOnce", () => {
  it("returns an empty poll result without checking out source", async () => {
    const runnerClient = client(null);
    const overrides = dependencies(runnerClient.value);

    const result = await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", runnerVersion: "1.26.1" },
      overrides,
    );

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
        readiness: {
          score: 84,
          status: "at-risk",
          blocking: 0,
          nonBlocking: 1,
          missingRequired: [],
          missingRecommended: ["assembly-drawing"],
          warnings: ["Recommended output assembly-drawing is missing."],
        },
        hardwareImpact: {
          version: 1,
          baseline: { status: "available", sha: "a".repeat(40) },
          candidate: { sha: "b".repeat(40) },
          facts: {
            readiness: {
              previousScore: 82,
              currentScore: 84,
              scoreDelta: 2,
              previousStatus: "at-risk",
              currentStatus: "at-risk",
              statusChanged: false,
            },
            findings: { added: 0, resolved: 1, addedBlocking: 0, resolvedBlocking: 0 },
            bom: { added: 0, removed: 0, changed: 0, truncated: false },
            manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 0 },
          },
          assessment: { materialChange: true, riskDirection: "decreased", affectedDomains: ["readiness", "findings"] },
          evidence: [],
        },
        waivers: {
          active: [
            {
              rule: "design.review",
              owner: "hardware-team",
              reason: "Approved for prototype lot.",
              expires: "2026-08-31",
              stale: false,
              expired: false,
              matched: 1,
            },
          ],
          expired: [],
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
      {
        identityFile: "/identity/runner.json",
        runnerVersion: "1.26.1",
        workspaceRoot: "/workspaces",
        heartbeatSeconds: 30,
      },
      overrides,
    );

    expect(result).toEqual({ status: "completed", runId, executionAttemptId: attemptId, decision: "pass" });
    expect(checkoutSource).toHaveBeenCalledWith({
      job: claimedJob(),
      workspaceRoot: path.join(path.resolve("/workspaces"), ".boardreadyops-active", runnerId),
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
        readiness: { score: 84, status: "at-risk", blocking: 0, nonBlocking: 1 },
        waivers: { active: [expect.objectContaining({ rule: "design.review", matched: 1 })], expired: [] },
        hardwareImpact: expect.objectContaining({
          version: 1,
          assessment: { materialChange: true, riskDirection: "decreased", affectedDomains: ["readiness", "findings"] },
        }),
        metrics: expect.objectContaining({
          readiness_score: 84,
          artifact_mode_metadata_only: 0,
          artifacts_generated: 1,
          artifacts_uploaded: 1,
          artifacts_suppressed: 0,
        }),
      },
    });
    expect(overrides.removeWorkspace).toHaveBeenCalledWith(workspace);
    expect(runnerClient.relinquish).not.toHaveBeenCalled();
  });

  it("suppresses artifact uploads in explicit metadata-only mode for a standard job", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-metadata-only-"));
    roots.push(workspace);
    const artifactFile = path.join(workspace, "result.json");
    await writeFile(artifactFile, "hello", "utf8");
    const runnerClient = client();
    const overrides = dependencies(runnerClient.value);
    const execution: RunnerExecutionOutput = {
      exitCode: 0,
      report: {
        findings: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
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
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(async () => execution),
    });

    const result = await runRunnerWorkerOnce(
      {
        identityFile: "/identity/runner.json",
        runnerVersion: "1.26.1",
        artifactMode: "metadata-only",
      },
      overrides,
    );

    expect(result).toMatchObject({ status: "completed", decision: "pass" });
    expect(runnerClient.issueArtifactCapabilities).not.toHaveBeenCalled();
    expect(runnerClient.uploadArtifact).not.toHaveBeenCalled();
    expect(
      (runnerClient.heartbeat.mock.calls as unknown as Array<[RunnerLeaseHeartbeatRequest]>).map(
        ([request]) => request.stage,
      ),
    ).toEqual(["preparing_source", "running", "reporting"]);
    const terminal = (
      runnerClient.publishTerminalResult.mock.calls as unknown as Array<[RunnerTerminalResultRequest]>
    )[0]?.[0];
    expect(terminal?.result.artifacts).toEqual([]);
    expect(terminal?.result.metrics).toMatchObject({
      artifact_mode_metadata_only: 1,
      artifacts_generated: 1,
      artifacts_uploaded: 0,
      artifacts_suppressed: 1,
    });
    expect(overrides.log).toHaveBeenCalledWith(
      "runner.artifacts.suppressed",
      expect.objectContaining({
        run_id: runId,
        execution_attempt_id: attemptId,
        artifacts: 1,
        artifact_mode: "metadata-only",
      }),
    );
  });

  it("records explicit metadata-only mode even when no artifacts were generated", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-metadata-only-empty-"));
    roots.push(workspace);
    const runnerClient = client();
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(
        async (): Promise<RunnerExecutionOutput> => ({
          exitCode: 0,
          report: {
            findings: [],
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          },
          artifacts: [],
        }),
      ),
    });

    await runRunnerWorkerOnce(
      {
        identityFile: "/identity/runner.json",
        runnerVersion: "1.26.1",
        artifactMode: "metadata-only",
      },
      overrides,
    );

    const terminal = (
      runnerClient.publishTerminalResult.mock.calls as unknown as Array<[RunnerTerminalResultRequest]>
    )[0]?.[0];
    expect(terminal?.result.metrics).toMatchObject({
      artifact_mode_metadata_only: 1,
      artifacts_generated: 0,
      artifacts_uploaded: 0,
      artifacts_suppressed: 0,
    });
  });

  it("suppresses artifact capabilities and uploads for safe-mode runs", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-safe-artifacts-"));
    roots.push(workspace);
    const artifactFile = path.join(workspace, "result.json");
    await writeFile(artifactFile, "hello", "utf8");
    const safeJob = claimedJob("customer_checkout", {
      enabled: true,
      reasons: ["private-repository"],
    });
    const runnerClient = client(safeJob);
    const overrides = dependencies(runnerClient.value);
    const execution: RunnerExecutionOutput = {
      exitCode: 0,
      report: {
        findings: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
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
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(async () => execution),
    });

    const result = await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", runnerVersion: "1.26.1" },
      overrides,
    );

    expect(result).toMatchObject({ status: "completed", decision: "pass" });
    expect(runnerClient.issueArtifactCapabilities).not.toHaveBeenCalled();
    expect(runnerClient.uploadArtifact).not.toHaveBeenCalled();
    expect(
      (runnerClient.heartbeat.mock.calls as unknown as Array<[RunnerLeaseHeartbeatRequest]>).map(
        ([request]) => request.stage,
      ),
    ).toEqual(["preparing_source", "running", "reporting"]);
    const terminal = (
      runnerClient.publishTerminalResult.mock.calls as unknown as Array<[RunnerTerminalResultRequest]>
    )[0]?.[0];
    expect(terminal?.result.artifacts).toEqual([]);
    expect(terminal?.result.metrics).toMatchObject({ artifacts_generated: 1, artifacts_suppressed: 1 });
    expect(overrides.log).toHaveBeenCalledWith("runner.artifacts.suppressed", {
      run_id: runId,
      execution_attempt_id: attemptId,
      artifacts: 1,
      artifact_mode: "control-plane",
      safe_mode_reasons: ["private-repository"],
    });
  });

  it("runs the real safe-mode pipeline without importing repository plugins or dispatching notifiers", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-safe-pipeline-"));
    roots.push(workspace);
    await cp(path.resolve("tests/fixtures/projects/safe-basic"), workspace, { recursive: true });
    await mkdir(path.join(workspace, "local-rules"), { recursive: true });
    await writeFile(
      path.join(workspace, "local-rules", "must-not-load.js"),
      'throw new Error("safe runner imported repository plugin code");\n',
      "utf8",
    );
    await writeFile(
      path.join(workspace, "boardreadyops.yml"),
      `version: 1
mode: warn
projects:
  - path: .
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
fail-on: high
notifiers:
  slack:
    enabled: true
    webhookEnv: SLACK_WEBHOOK_URL
    minSeverity: high
`,
      "utf8",
    );
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/services/T000/B000/secret");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      requests.push(String(url));
      return new Response(null, { status: 204 });
    });
    const safeJob = claimedJob("customer_checkout", { enabled: true, reasons: ["private-repository"] });
    const runnerClient = client(safeJob);
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: executeRunnerPipeline,
    });

    const result = await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", runnerVersion: "1.26.1", keepWorkspace: true, requireKicad: false },
      overrides,
    );

    expect(result).toMatchObject({ status: "completed", decision: "pass" });
    expect(requests).toEqual([]);
    expect(runnerClient.issueArtifactCapabilities).not.toHaveBeenCalled();
    expect(runnerClient.uploadArtifact).not.toHaveBeenCalled();
    const terminal = (
      runnerClient.publishTerminalResult.mock.calls as unknown as Array<[RunnerTerminalResultRequest]>
    )[0]?.[0];
    expect(terminal?.result.artifacts).toEqual([]);
    expect(terminal?.result.metrics).toMatchObject({ artifacts_generated: 3, artifacts_suppressed: 3 });
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
      { identityFile: "/identity/runner.json", runnerVersion: "1.26.1", keepWorkspace: true, requireKicad: false },
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
    expect(terminal?.result.readiness).toMatchObject({ score: 100, status: "ready" });
  });

  it("rejects broker source mode and relinquishes before checkout", async () => {
    const runnerClient = client(claimedJob("broker"));
    const overrides = dependencies(runnerClient.value);

    await expect(
      runRunnerWorkerOnce({ identityFile: "/identity/runner.json", runnerVersion: "1.26.1" }, overrides),
    ).rejects.toThrow(/managed source boundary/u);

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

    await expect(
      runRunnerWorkerOnce({ identityFile: "/identity/runner.json", runnerVersion: "1.26.1" }, overrides),
    ).rejects.toThrow(/local analyzer failed/u);

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

    await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", runnerVersion: "1.26.1", keepWorkspace: true },
      overrides,
    );

    expect(overrides.removeWorkspace).not.toHaveBeenCalled();
  });

  it("forces workspace cleanup for safe-mode jobs even when retention is requested", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-safe-cleanup-"));
    roots.push(workspace);
    const safeJob = claimedJob("customer_checkout", {
      enabled: true,
      reasons: ["private-repository"],
    });
    const runnerClient = client(safeJob);
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(async () => ({ exitCode: 0, artifacts: [] })),
    });

    await runRunnerWorkerOnce(
      { identityFile: "/identity/runner.json", runnerVersion: "1.26.1", keepWorkspace: true },
      overrides,
    );

    expect(overrides.removeWorkspace).toHaveBeenCalledWith(workspace);
    expect(overrides.log).toHaveBeenCalledWith("runner.workspace.retention_overridden", {
      run_id: runId,
      execution_attempt_id: attemptId,
      safe_mode_reasons: ["private-repository"],
    });
  });

  it("aborts in-flight execution, relinquishes the lease for shutdown, and cleans the workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-abort-"));
    roots.push(workspace);
    const runnerClient = client();
    const overrides = dependencies(runnerClient.value);
    const controller = new AbortController();
    Object.assign(overrides, {
      checkoutSource: vi.fn(async () => workspace),
      executePipeline: vi.fn(async (_workspace, _job, runOptions) => {
        const signal = (runOptions as { requireKicad: boolean; signal?: AbortSignal }).signal;
        if (!signal) throw new Error("runner execution signal missing");
        expect(signal).toBe(controller.signal);
        return await new Promise<RunnerExecutionOutput>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason instanceof Error ? signal.reason : new Error("runner execution aborted")),
            { once: true },
          );
          queueMicrotask(() => controller.abort());
        });
      }),
    });

    await expect(
      runRunnerWorkerOnce(
        {
          identityFile: "/identity/runner.json",
          runnerVersion: "1.26.1",
          signal: controller.signal,
        },
        overrides,
      ),
    ).rejects.toThrow(/runner shutdown requested/u);

    expect(runnerClient.relinquish).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "shutdown", message: "runner shutdown requested" }),
    );
    expect(overrides.removeWorkspace).toHaveBeenCalledWith(workspace);
    expect(runnerClient.publishTerminalResult).not.toHaveBeenCalled();
  });

  it("refuses to start the real runner pipeline when its execution signal is already aborted", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-pre-abort-"));
    roots.push(workspace);
    await cp(path.resolve("tests/fixtures/projects/safe-basic"), workspace, { recursive: true });
    const controller = new AbortController();
    controller.abort();
    const options = {
      requireKicad: false,
      signal: controller.signal,
    } as Parameters<typeof executeRunnerPipeline>[2] & { signal: AbortSignal };

    await expect(executeRunnerPipeline(workspace, claimedJob(), options)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("serveRunnerWorker", () => {
  it("removes only this runner identity's managed crash leftovers before polling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-recovery-"));
    roots.push(root);
    const orphan = path.join(root, ".boardreadyops-active", runnerId, "orphaned-workspace");
    const otherRunnerId = "66666666-6666-4666-8666-666666666666";
    const otherRunnerWorkspace = path.join(root, ".boardreadyops-active", otherRunnerId, "still-owned-elsewhere");
    const customerFile = path.join(root, "customer-owned.txt");
    await mkdir(orphan, { recursive: true });
    await writeFile(path.join(orphan, "private-board.kicad_pcb"), "source", "utf8");
    await mkdir(otherRunnerWorkspace, { recursive: true });
    await writeFile(customerFile, "keep", "utf8");

    const runnerClient = client(null);
    const controller = new AbortController();
    const overrides = dependencies(runnerClient.value);
    Object.assign(overrides, {
      sleep: vi.fn(async () => controller.abort()),
    });

    await serveRunnerWorker(
      {
        identityFile: "/identity/runner.json",
        runnerVersion: "1.26.1",
        workspaceRoot: root,
        signal: controller.signal,
      },
      overrides,
    );

    await expect(access(path.join(root, ".boardreadyops-active", runnerId))).rejects.toThrow();
    await expect(access(otherRunnerWorkspace)).resolves.toBeUndefined();
    await expect(access(customerFile)).resolves.toBeUndefined();
    expect(overrides.log).toHaveBeenCalledWith("runner.workspace.crash_recovery_cleanup", {
      workspaces_removed: 1,
    });
    expect(runnerClient.claim).toHaveBeenCalledTimes(1);
  });

  it("fails closed before polling when the managed workspace namespace is not a directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-recovery-invalid-"));
    roots.push(root);
    await writeFile(path.join(root, ".boardreadyops-active"), "unexpected", "utf8");
    const runnerClient = client(null);
    const overrides = dependencies(runnerClient.value);

    await expect(
      serveRunnerWorker(
        {
          identityFile: "/identity/runner.json",
          runnerVersion: "1.26.1",
          workspaceRoot: root,
        },
        overrides,
      ),
    ).rejects.toThrow(/active workspace namespace is not a regular directory/u);

    expect(runnerClient.claim).not.toHaveBeenCalled();
  });
});
