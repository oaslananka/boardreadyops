import path from "node:path";
import { issueRunnerEnrollment } from "../../../packages/db/src/runner-enrollment-admin.js";
import type { RunnerRegistrationScope } from "../../../packages/db/src/runner-registration-enrollment-store.js";
import { activateRunnerIdentity, defaultRunnerIdentityDirectory } from "../../runner/identity.js";
import {
  defaultRunnerWorkspaceRoot,
  type RunnerWorkerOptions,
  runRunnerWorkerOnce,
  serveRunnerWorker,
} from "../../runner/worker.js";
import { executeRunnerPipeline } from "../runner-pipeline.js";

export type RunnerOutputFormat = "text" | "json";

export type RunnerIssueEnrollmentCliOptions = {
  databaseUrlFile: string;
  installationId: string;
  name: string;
  scope: RunnerRegistrationScope;
  repository?: string[];
  tokenOutput: string;
  ttlSeconds?: number;
  format?: RunnerOutputFormat;
};

export type RunnerActivateCliOptions = {
  url: string;
  enrollmentTokenFile: string;
  identityDir?: string;
  capability?: string[];
  label?: string[];
  format?: RunnerOutputFormat;
};

export type RunnerWorkCliOptions = {
  identity?: string;
  workspaceRoot?: string;
  repositoryMirrorRoot?: string;
  heartbeatSeconds?: number;
  pollSeconds?: number;
  requireKicad?: boolean;
  keepWorkspace?: boolean;
  format?: RunnerOutputFormat;
};

type RunnerStreams = { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };

export async function runnerIssueEnrollmentCommand(
  options: RunnerIssueEnrollmentCliOptions,
  streams: RunnerStreams,
): Promise<number> {
  try {
    const issued = await issueRunnerEnrollment({
      databaseUrlFile: path.resolve(options.databaseUrlFile),
      installationId: options.installationId,
      name: options.name,
      scope: options.scope,
      allowedRepositories: options.repository ?? [],
      tokenOutputFile: path.resolve(options.tokenOutput),
      ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
    });
    writeRunnerOutput(
      streams.stdout,
      options.format,
      {
        status: "accepted",
        registrationId: issued.registrationId,
        expiresAt: issued.expiresAt,
        tokenOutputFile: issued.tokenOutputFile,
      },
      `Enrollment ${issued.registrationId} expires at ${issued.expiresAt}; token written to ${issued.tokenOutputFile}.`,
    );
    return 0;
  } catch (error) {
    streams.stderr.write(`Runner enrollment issuance failed: ${safeMessage(error)}\n`);
    return 4;
  }
}

export async function runnerActivateCommand(
  options: RunnerActivateCliOptions,
  streams: RunnerStreams,
): Promise<number> {
  try {
    const activated = await activateRunnerIdentity({
      controlPlaneUrl: options.url,
      enrollmentTokenFile: path.resolve(options.enrollmentTokenFile),
      identityDirectory: path.resolve(options.identityDir ?? defaultRunnerIdentityDirectory()),
      capabilities: options.capability ?? [],
      labels: options.label ?? [],
    });
    writeRunnerOutput(
      streams.stdout,
      options.format,
      {
        status: activated.status,
        runnerId: activated.runnerId,
        identityFile: activated.identityFile,
        privateKeyFile: activated.privateKeyFile,
        publicKeyFile: activated.publicKeyFile,
      },
      `Runner ${activated.runnerId} ${activated.status}; identity written to ${activated.identityFile}.`,
    );
    return 0;
  } catch (error) {
    streams.stderr.write(`Runner activation failed: ${safeMessage(error)}\n`);
    return 4;
  }
}

export async function runnerOnceCommand(options: RunnerWorkCliOptions, streams: RunnerStreams): Promise<number> {
  try {
    const result = await runRunnerWorkerOnce(workerOptions(options), {
      executePipeline: executeRunnerPipeline,
      log: createRunnerLogger(streams.stderr, options.format),
    });
    writeRunnerOutput(
      streams.stdout,
      options.format,
      result,
      result.status === "empty"
        ? `No runner job was available; retry after ${result.retryAfterSeconds}s.`
        : `Runner completed ${result.runId}/${result.executionAttemptId} with decision ${result.decision}.`,
    );
    return 0;
  } catch (error) {
    streams.stderr.write(`Runner job failed: ${safeMessage(error)}\n`);
    return 4;
  }
}

export async function runnerServeCommand(options: RunnerWorkCliOptions, streams: RunnerStreams): Promise<number> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    writeRunnerOutput(
      streams.stdout,
      options.format,
      { status: "started", identityFile: identityPath(options), workspaceRoot: workspacePath(options) },
      `Runner service started with identity ${identityPath(options)}.`,
    );
    await serveRunnerWorker(
      {
        ...workerOptions(options),
        signal: abort.signal,
      },
      {
        executePipeline: executeRunnerPipeline,
        log: createRunnerLogger(streams.stderr, options.format),
      },
    );
    writeRunnerOutput(streams.stdout, options.format, { status: "stopped" }, "Runner service stopped.");
    return 0;
  } catch (error) {
    streams.stderr.write(`Runner service failed: ${safeMessage(error)}\n`);
    return 4;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function workerOptions(options: RunnerWorkCliOptions): RunnerWorkerOptions {
  return {
    identityFile: identityPath(options),
    workspaceRoot: workspacePath(options),
    ...(options.repositoryMirrorRoot === undefined
      ? {}
      : { repositoryMirrorRoot: path.resolve(options.repositoryMirrorRoot) }),
    ...(options.heartbeatSeconds === undefined ? {} : { heartbeatSeconds: options.heartbeatSeconds }),
    ...(options.pollSeconds === undefined ? {} : { pollSeconds: options.pollSeconds }),
    requireKicad: options.requireKicad ?? true,
    keepWorkspace: options.keepWorkspace ?? false,
  };
}

function identityPath(options: RunnerWorkCliOptions): string {
  return path.resolve(options.identity ?? path.join(defaultRunnerIdentityDirectory(), "runner.json"));
}

function workspacePath(options: RunnerWorkCliOptions): string {
  return path.resolve(options.workspaceRoot ?? defaultRunnerWorkspaceRoot());
}

function createRunnerLogger(stream: NodeJS.WritableStream, format: RunnerOutputFormat | undefined) {
  return (event: string, fields: Readonly<Record<string, unknown>> = {}) => {
    if (format === "json") {
      stream.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
      return;
    }
    const detail = Object.keys(fields).length === 0 ? "" : ` ${JSON.stringify(fields)}`;
    stream.write(`[runner] ${event}${detail}\n`);
  };
}

function writeRunnerOutput(
  stream: NodeJS.WritableStream,
  format: RunnerOutputFormat | undefined,
  value: unknown,
  text: string,
): void {
  stream.write(format === "json" ? `${JSON.stringify(value)}\n` : `${text}\n`);
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return Array.from(message, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .slice(0, 1000);
}
