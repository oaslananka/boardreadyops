import { lstat, readdir, rm } from "node:fs/promises";
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

export type RunnerArtifactMode = "control-plane" | "metadata-only";

export type RunnerWorkerOptions = {
  identityFile: string;
  runnerVersion: string;
  workspaceRoot?: string;
  repositoryMirrorRoot?: string;
  heartbeatSeconds?: number;
  pollSeconds?: number;
  requireKicad?: boolean;
  keepWorkspace?: boolean;
  artifactMode?: RunnerArtifactMode;
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
  readiness?: NonNullable<ReleaseRunResult["readiness"]>;
  waivers?: NonNullable<ReleaseRunResult["waivers"]>;
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
    runnerVersion: string,
  ) => RunnerWorkerClient;
  checkoutSource: typeof checkoutRunnerSource;
  executePipeline: (
    workspace: string,
    job: RunnerClaimedJob,
    options: { requireKicad: boolean; signal?: AbortSignal },
  ) => Promise<RunnerExecutionOutput>;
  removeWorkspace: (workspace: string) => Promise<void>;
  recoverCrashWorkspaces: (workspaceRoot: string, runnerId: string) => Promise<number>;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  log: RunnerWorkerLog;
};

const defaultDependencies: RunnerWorkerDependencies = {
  loadIdentity: loadRunnerIdentity,
  loadPrivateKey: loadRunnerPrivateKey,
  createClient: (identity, privateKey, runnerVersion) =>
    new RunnerControlPlaneClient({
      baseUrl: identity.controlPlaneUrl,
      runnerId: identity.runnerId,
      runnerVersion,
      privateKey,
    }),
  checkoutSource: checkoutRunnerSource,
  executePipeline: async () => {
    throw new Error("runner execution pipeline adapter is not configured");
  },
  removeWorkspace: async (workspace) => await rm(workspace, { recursive: true, force: true }),
  recoverCrashWorkspaces: recoverRunnerCrashWorkspaces,
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
  const client = dependencies.createClient(identity, privateKey, options.runnerVersion);
  const heartbeatSeconds = boundedSeconds(options.heartbeatSeconds ?? 30, "heartbeatSeconds", 5, 300);
  const workspaceRoot = runnerActiveWorkspaceRoot(
    path.resolve(options.workspaceRoot ?? defaultRunnerWorkspaceRoot()),
    identity.runnerId,
  );
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

  await validateClaimedRunnerJob(client, job, options.signal);

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
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (options.signal?.aborted) throw new RunnerShutdownError();
    heartbeat.assertLeaseActive();

    const artifactMode = options.artifactMode ?? "control-plane";
    const uploadedArtifacts = await resolveExecutionArtifacts(
      dependencies,
      client,
      job,
      execution,
      artifactMode,
      heartbeat,
    );

    heartbeat.setStage("reporting");
    await heartbeat.pulse();
    const result = terminalResultFromExecution(job, execution, uploadedArtifacts, artifactMode);
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
    throw await handleRunnerExecutionFailure(client, job, error, options.signal, terminalPublished);
  } finally {
    await heartbeat.stop();
    await cleanupRunnerWorkspace(dependencies, job, workspace, options.keepWorkspace);
  }
}

async function validateClaimedRunnerJob(
  client: RunnerWorkerClient,
  job: RunnerClaimedJob,
  signal?: AbortSignal,
): Promise<void> {
  if (job.sourceMode !== "customer_checkout") {
    await bestEffortRelinquish(
      client,
      job,
      "job_error",
      "Self-hosted runner refused a non-customer checkout assignment.",
    );
    throw new Error("self-hosted runner received a source assignment that would cross the managed source boundary");
  }
  if (signal?.aborted) {
    await bestEffortRelinquish(client, job, "shutdown", "Runner stopped before source checkout.");
    throw new Error("runner shutdown requested before job execution");
  }
}

async function resolveExecutionArtifacts(
  dependencies: RunnerWorkerDependencies,
  client: RunnerWorkerClient,
  job: RunnerClaimedJob,
  execution: RunnerExecutionOutput,
  artifactMode: RunnerArtifactMode,
  heartbeat: ReturnType<typeof createHeartbeatController>,
): Promise<ReleaseRunResult["artifacts"]> {
  if (job.safeMode.enabled || artifactMode === "metadata-only") {
    if (execution.artifacts.length > 0) {
      dependencies.log("runner.artifacts.suppressed", {
        run_id: job.runId,
        execution_attempt_id: job.executionAttemptId,
        artifacts: execution.artifacts.length,
        artifact_mode: artifactMode,
        safe_mode_reasons: [...job.safeMode.reasons],
      });
    }
    return [];
  }

  heartbeat.setStage("uploading_artifacts");
  await heartbeat.pulse();
  const uploadedArtifacts = await publishArtifacts(client, job, execution.artifacts);
  heartbeat.assertLeaseActive();
  return uploadedArtifacts;
}

async function handleRunnerExecutionFailure(
  client: RunnerWorkerClient,
  job: RunnerClaimedJob,
  error: unknown,
  signal: AbortSignal | undefined,
  terminalPublished: boolean,
): Promise<unknown> {
  const shutdown = error instanceof RunnerShutdownError || signal?.aborted === true;
  const reportedError = shutdown && !(error instanceof RunnerShutdownError) ? new RunnerShutdownError() : error;
  if (!terminalPublished) {
    await bestEffortRelinquish(client, job, shutdown ? "shutdown" : "job_error", sanitizedErrorMessage(reportedError));
  }
  return reportedError;
}

async function cleanupRunnerWorkspace(
  dependencies: RunnerWorkerDependencies,
  job: RunnerClaimedJob,
  workspace: string | undefined,
  keepWorkspace: boolean | undefined,
): Promise<void> {
  if (!workspace || (!job.safeMode.enabled && keepWorkspace === true)) return;
  if (job.safeMode.enabled && keepWorkspace === true) {
    dependencies.log("runner.workspace.retention_overridden", {
      run_id: job.runId,
      execution_attempt_id: job.executionAttemptId,
      safe_mode_reasons: [...job.safeMode.reasons],
    });
  }
  await dependencies.removeWorkspace(workspace);
}

export async function serveRunnerWorker(
  options: RunnerWorkerOptions,
  overrides: Partial<RunnerWorkerDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const pollSeconds = boundedSeconds(options.pollSeconds ?? 15, "pollSeconds", 1, 300);
  const identity = await dependencies.loadIdentity(options.identityFile);
  if (options.signal?.aborted) return;
  const recovered = await dependencies.recoverCrashWorkspaces(
    path.resolve(options.workspaceRoot ?? defaultRunnerWorkspaceRoot()),
    identity.runnerId,
  );
  if (recovered > 0) {
    dependencies.log("runner.workspace.crash_recovery_cleanup", { workspaces_removed: recovered });
  }
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
  artifactMode: RunnerArtifactMode,
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
      artifact_mode_metadata_only: artifactMode === "metadata-only" ? 1 : 0,
      artifacts_generated: execution.artifacts.length,
      artifacts_uploaded: artifacts.length,
      artifacts_suppressed: Math.max(0, execution.artifacts.length - artifacts.length),
      ...(execution.report?.readiness ? { readiness_score: execution.report.readiness.score } : {}),
    },
    ...(execution.report?.readiness ? { readiness: execution.report.readiness } : {}),
    ...(execution.report?.waivers ? { waivers: execution.report.waivers } : {}),
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

function runnerActiveWorkspaceRoot(workspaceRoot: string, runnerId: string): string {
  return path.join(path.resolve(workspaceRoot), ".boardreadyops-active", runnerId);
}

async function recoverRunnerCrashWorkspaces(workspaceRoot: string, runnerId: string): Promise<number> {
  const root = path.resolve(workspaceRoot);
  const namespace = path.join(root, ".boardreadyops-active");
  const namespaceInfo = await lstat(namespace).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!namespaceInfo) return 0;
  if (namespaceInfo.isSymbolicLink() || !namespaceInfo.isDirectory()) {
    throw new Error("runner active workspace namespace is not a regular directory");
  }

  const activeRoot = runnerActiveWorkspaceRoot(root, runnerId);
  const activeInfo = await lstat(activeRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!activeInfo) return 0;
  if (activeInfo.isSymbolicLink() || !activeInfo.isDirectory()) {
    throw new Error("runner identity workspace namespace is not a regular directory");
  }
  const entries = await readdir(activeRoot);
  await rm(activeRoot, { recursive: true, force: true });
  return entries.length;
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
