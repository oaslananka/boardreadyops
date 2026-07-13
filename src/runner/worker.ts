import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ReleaseRunResult,
  type RunnerArtifactCapabilityRequest,
  type RunnerClaimedJob,
  type RunnerLeaseHeartbeatRequest,
  type RunnerLeaseRelinquishRequest,
  type RunnerTerminalResultRequest,
  releaseRunResultSchema,
} from "../../packages/contracts/src/index.js";
import { loadRunnerPrivateKey, RunnerControlPlaneClient } from "./client.js";
import { type LoadedRunnerIdentity, loadRunnerIdentity } from "./identity.js";
import { checkoutRunnerSource } from "./source.js";

export type RunnerWorkerOptions = {
  identityFile: string;
  workspaceRoot?: string;
  repositoryMirrorRoot?: string;
  heartbeatSeconds?: number;
  pollSeconds?: number;
  requireKicad?: boolean;
  keepWorkspace?: boolean;
  signal?: AbortSignal;
};

export type RunnerWorkerResult =
  | { status: "empty"; retryAfterSeconds: number }
  | { status: "completed"; runId: string; executionAttemptId: string; decision: "pass" | "fail" | "error" };

type RunnerWorkerLog = (event: string, fields?: Readonly<Record<string, unknown>>) => void;

export type RunnerExecutionArtifact = {
  kind: string;
  name: string;
  role: string;
  filePath: string;
  bytes: number;
  sha256: string;
};

type RunnerExecutionReport = {
  summary?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: Array<{
    ruleId: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    message: string;
    resource: { path?: string };
  }>;
};

export type RunnerExecutionOutput = {
  exitCode: number;
  report?: RunnerExecutionReport;
  artifacts: RunnerExecutionArtifact[];
};

export type RunnerWorkerClient = Pick<
  RunnerControlPlaneClient,
  "claim" | "heartbeat" | "relinquish" | "issueArtifactCapabilities" | "uploadArtifact" | "publishTerminalResult"
>;

export type RunnerWorkerDependencies = {
  loadIdentity: typeof loadRunnerIdentity;
  loadPrivateKey: typeof loadRunnerPrivateKey;
  createClient: (
    identity: LoadedRunnerIdentity,
    privateKey: Awaited<ReturnType<typeof loadRunnerPrivateKey>>,
  ) => RunnerWorkerClient;
  checkoutSource: typeof checkoutRunnerSource;
  executePipeline: (
    workspace: string,
    job: RunnerClaimedJob,
    options: { requireKicad: boolean },
  ) => Promise<RunnerExecutionOutput>;
  removeWorkspace: (workspace: string) => Promise<void>;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  log: RunnerWorkerLog;
};

const defaultDependencies: RunnerWorkerDependencies = {
  loadIdentity: loadRunnerIdentity,
  loadPrivateKey: loadRunnerPrivateKey,
  createClient: (identity, privateKey) =>
    new RunnerControlPlaneClient({
      baseUrl: identity.controlPlaneUrl,
      runnerId: identity.runnerId,
      privateKey,
    }),
  checkoutSource: checkoutRunnerSource,
  executePipeline: async () => {
    throw new Error("runner execution pipeline adapter is not configured");
  },
  removeWorkspace: async (workspace) => await rm(workspace, { recursive: true, force: true }),
  sleep: abortableSleep,
  log: () => undefined,
};

export function defaultRunnerWorkspaceRoot(): string {
  return path.join(os.homedir(), ".cache", "boardreadyops", "runner-workspaces");
}

export async function runRunnerWorkerOnce(
  options: RunnerWorkerOptions,
  overrides: Partial<RunnerWorkerDependencies> = {},
): Promise<RunnerWorkerResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const identity = await dependencies.loadIdentity(options.identityFile);
  const privateKey = await dependencies.loadPrivateKey(identity.privateKeyPath);
  const client = dependencies.createClient(identity, privateKey);
  const heartbeatSeconds = boundedSeconds(options.heartbeatSeconds ?? 30, "heartbeatSeconds", 5, 300);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultRunnerWorkspaceRoot());
  const claim = await client.claim({
    protocolVersion: 1,
    workerClass: "self_hosted",
    capabilities: identity.capabilities,
    labels: identity.labels,
  });
  if (claim.status === "empty") {
    dependencies.log("runner.claim.empty", { retry_after_seconds: claim.retryAfterSeconds });
    return { status: "empty", retryAfterSeconds: claim.retryAfterSeconds };
  }

  const job = claim.job;
  dependencies.log("runner.claim.accepted", {
    run_id: job.runId,
    execution_attempt_id: job.executionAttemptId,
    repository: `${job.repository.owner}/${job.repository.name}`,
    private: job.repository.private,
    source_mode: job.sourceMode,
  });

  if (job.sourceMode !== "customer_checkout") {
    await bestEffortRelinquish(
      client,
      job,
      "job_error",
      "Self-hosted runner refused a non-customer checkout assignment.",
    );
    throw new Error("self-hosted runner received a source assignment that would cross the managed source boundary");
  }
  if (options.signal?.aborted) {
    await bestEffortRelinquish(client, job, "shutdown", "Runner stopped before source checkout.");
    throw new Error("runner shutdown requested before job execution");
  }

  let workspace: string | undefined;
  let terminalPublished = false;
  const heartbeat = createHeartbeatController(client, job, heartbeatSeconds, dependencies.log);
  try {
    heartbeat.setStage("preparing_source");
    await heartbeat.pulse();
    workspace = await dependencies.checkoutSource({
      job,
      workspaceRoot,
      ...(options.repositoryMirrorRoot === undefined ? {} : { repositoryMirrorRoot: options.repositoryMirrorRoot }),
    });
    if (options.signal?.aborted) throw new RunnerShutdownError();

    heartbeat.setStage("running");
    await heartbeat.pulse();
    heartbeat.start();
    const execution = await dependencies.executePipeline(workspace, job, {
      requireKicad: options.requireKicad ?? true,
    });
    if (options.signal?.aborted) throw new RunnerShutdownError();
    heartbeat.assertLeaseActive();

    heartbeat.setStage("uploading_artifacts");
    await heartbeat.pulse();
    const uploadedArtifacts = await publishArtifacts(client, job, execution.artifacts);
    heartbeat.assertLeaseActive();

    heartbeat.setStage("reporting");
    await heartbeat.pulse();
    const result = terminalResultFromExecution(job, execution, uploadedArtifacts);
    const request: RunnerTerminalResultRequest = {
      protocolVersion: 1,
      runId: job.runId,
      executionAttemptId: job.executionAttemptId,
      leaseId: job.leaseId,
      leaseToken: job.leaseToken,
      result,
    };
    await client.publishTerminalResult(request);
    terminalPublished = true;
    dependencies.log("runner.result.published", {
      run_id: job.runId,
      execution_attempt_id: job.executionAttemptId,
      decision: result.decision,
      artifacts: result.artifacts.length,
      findings: result.findings.length,
    });
    return {
      status: "completed",
      runId: job.runId,
      executionAttemptId: job.executionAttemptId,
      decision: result.decision ?? "error",
    };
  } catch (error) {
    if (!terminalPublished) {
      const reason = error instanceof RunnerShutdownError ? "shutdown" : "job_error";
      await bestEffortRelinquish(client, job, reason, sanitizedErrorMessage(error));
    }
    throw error;
  } finally {
    await heartbeat.stop();
    if (workspace && options.keepWorkspace !== true) {
      await dependencies.removeWorkspace(workspace);
    }
  }
}

export async function serveRunnerWorker(
  options: RunnerWorkerOptions,
  overrides: Partial<RunnerWorkerDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const pollSeconds = boundedSeconds(options.pollSeconds ?? 15, "pollSeconds", 1, 300);
  await dependencies.loadIdentity(options.identityFile);
  while (!options.signal?.aborted) {
    try {
      const result = await runRunnerWorkerOnce(options, dependencies);
      if (result.status === "empty") {
        await dependencies.sleep(Math.max(pollSeconds, result.retryAfterSeconds) * 1000, options.signal);
      }
    } catch (error) {
      if (options.signal?.aborted || error instanceof RunnerShutdownError) return;
      dependencies.log("runner.loop.error", { error: sanitizedErrorMessage(error) });
      await dependencies.sleep(pollSeconds * 1000, options.signal).catch(() => undefined);
    }
  }
}

function createHeartbeatController(
  client: RunnerWorkerClient,
  job: RunnerClaimedJob,
  heartbeatSeconds: number,
  log: RunnerWorkerLog,
) {
  let stage: RunnerLeaseHeartbeatRequest["stage"] = "claimed";
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let leaseLost: string | undefined;

  const pulse = async () => {
    inFlight = inFlight.then(async () => {
      if (leaseLost) return;
      try {
        const response = await client.heartbeat({
          protocolVersion: 1,
          runId: job.runId,
          executionAttemptId: job.executionAttemptId,
          leaseId: job.leaseId,
          leaseToken: job.leaseToken,
          stage,
        });
        if (response.status !== "active") {
          leaseLost = response.status;
          log("runner.lease.closed", { run_id: job.runId, status: response.status });
        }
      } catch (error) {
        log("runner.heartbeat.error", { run_id: job.runId, error: sanitizedErrorMessage(error) });
      }
    });
    await inFlight;
  };

  return {
    setStage(value: RunnerLeaseHeartbeatRequest["stage"]) {
      stage = value;
    },
    pulse,
    start() {
      if (timer) return;
      timer = setInterval(() => void pulse(), heartbeatSeconds * 1000);
      timer.unref?.();
    },
    assertLeaseActive() {
      if (leaseLost) throw new Error(`runner lease is no longer active: ${leaseLost}`);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await inFlight;
    },
  };
}

async function publishArtifacts(
  client: RunnerWorkerClient,
  job: RunnerClaimedJob,
  artifacts: readonly RunnerExecutionArtifact[],
): Promise<ReleaseRunResult["artifacts"]> {
  if (artifacts.length === 0) return [];
  const request: RunnerArtifactCapabilityRequest = {
    protocolVersion: 1,
    runId: job.runId,
    executionAttemptId: job.executionAttemptId,
    leaseId: job.leaseId,
    leaseToken: job.leaseToken,
    artifacts: artifacts.map((artifact) => ({
      kind: artifact.kind,
      name: artifact.name,
      role: artifact.role,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    })),
  };
  const capabilities = await client.issueArtifactCapabilities(request);
  if (capabilities.uploads.length !== artifacts.length) {
    throw new Error("artifact capability response did not match the artifact declaration count");
  }
  const published: ReleaseRunResult["artifacts"] = [];
  for (const [index, artifact] of artifacts.entries()) {
    const capability = capabilities.uploads[index];
    if (capability?.maximumBytes !== artifact.bytes) {
      throw new Error("artifact capability did not match the declared artifact size");
    }
    await client.uploadArtifact(capability.uploadUrl, artifact.filePath, capability.maximumBytes);
    published.push({
      kind: artifact.kind,
      name: artifact.name,
      role: artifact.role,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      storagePath: capability.storagePath,
    });
  }
  return published;
}

function terminalResultFromExecution(
  job: RunnerClaimedJob,
  execution: RunnerExecutionOutput,
  artifacts: ReleaseRunResult["artifacts"],
): ReleaseRunResult {
  const completed = execution.exitCode === 0 || execution.exitCode === 1;
  const decision = decisionFromExitCode(execution.exitCode);
  const findings = execution.report
    ? execution.report.findings.slice(0, 500).map((finding) => ({
        ruleId: finding.ruleId.slice(0, 256),
        severity: finding.severity === "critical" ? ("error" as const) : finding.severity,
        message: finding.message.slice(0, 4000),
        ...(finding.resource.path ? { path: finding.resource.path.slice(0, 1024) } : {}),
      }))
    : [
        {
          ruleId: "runner.execution",
          severity: "error" as const,
          message: `BoardReadyOps runner exited with code ${execution.exitCode} before producing a result report.`,
        },
      ];
  const summary = execution.report?.summary;
  return releaseRunResultSchema.parse({
    version: 1,
    executionAttemptId: job.executionAttemptId,
    status: completed ? "completed" : "failed",
    decision,
    findings,
    artifacts,
    metrics: {
      exit_code: execution.exitCode,
      findings_total: summary?.total ?? findings.length,
      findings_critical: summary?.critical ?? 0,
      findings_high: summary?.high ?? 0,
      findings_medium: summary?.medium ?? 0,
      findings_low: summary?.low ?? 0,
      findings_info: summary?.info ?? 0,
    },
    reportLinks: [],
  });
}

async function bestEffortRelinquish(
  client: RunnerWorkerClient,
  job: RunnerClaimedJob,
  reason: RunnerLeaseRelinquishRequest["reason"],
  message: string,
): Promise<void> {
  await client
    .relinquish({
      protocolVersion: 1,
      runId: job.runId,
      executionAttemptId: job.executionAttemptId,
      leaseId: job.leaseId,
      leaseToken: job.leaseToken,
      reason,
      message: message.slice(0, 1000),
    })
    .catch(() => undefined);
}

function boundedSeconds(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function decisionFromExitCode(exitCode: number): "pass" | "fail" | "error" {
  if (exitCode === 0) return "pass";
  if (exitCode === 1) return "fail";
  return "error";
}

function sanitizedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const sanitized = Array.from(message, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  return sanitized.slice(0, 1000) || "Runner job failed.";
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new RunnerShutdownError();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new RunnerShutdownError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

class RunnerShutdownError extends Error {
  constructor() {
    super("runner shutdown requested");
    this.name = "RunnerShutdownError";
  }
}
