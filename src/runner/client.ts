import { createPrivateKey, type KeyLike, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { signRunnerRequest } from "../../packages/cloud-core/src/runner-request-signature.js";
import {
  type RunnerArtifactCapabilityRequest,
  type RunnerArtifactCapabilityResponse,
  type RunnerClaimRequest,
  type RunnerClaimResponse,
  type RunnerLeaseHeartbeatRequest,
  type RunnerLeaseRelinquishRequest,
  type RunnerRegistrationActivationResponse,
  type RunnerTerminalResultRequest,
  runnerArtifactCapabilityResponseSchema,
  runnerClaimResponseSchema,
  runnerLeaseHeartbeatResponseSchema,
  runnerMutationResponseSchema,
  runnerRegistrationActivationResponseSchema,
} from "../../packages/contracts/src/index.js";

export type RunnerFetch = typeof fetch;

export type RunnerControlPlaneClientOptions = {
  baseUrl: string;
  runnerId: string;
  privateKey: KeyLike;
  fetch?: RunnerFetch;
  now?: () => Date;
  nonce?: () => string;
  requestTimeoutMs?: number;
};

export type ActivateRunnerInput = {
  baseUrl: string;
  enrollmentToken: string;
  publicKey: string;
  capabilities: readonly string[];
  fetch?: RunnerFetch;
  requestTimeoutMs?: number;
};

export type RunnerSignedRequestContext = {
  runId?: string;
  executionAttemptId?: string;
  leaseId?: string;
};

const responseBodyLimitBytes = 1024 * 1024;

const runnerProtocolHeaderNames = {
  protocolVersion: "x-boardreadyops-runner-protocol-version",
  algorithm: "x-boardreadyops-runner-algorithm",
  workerClass: "x-boardreadyops-runner-worker-class",
  runnerId: "x-boardreadyops-runner-id",
  timestamp: "x-boardreadyops-runner-timestamp",
  nonce: "x-boardreadyops-runner-nonce",
  signature: "x-boardreadyops-runner-signature",
} as const;

export class RunnerControlPlaneError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = "RunnerControlPlaneError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class RunnerControlPlaneClient {
  readonly baseUrl: URL;
  readonly runnerId: string;
  readonly privateKey: KeyLike;
  readonly fetchImpl: RunnerFetch;
  readonly now: () => Date;
  readonly nonce: () => string;
  readonly requestTimeoutMs: number;

  constructor(options: RunnerControlPlaneClientOptions) {
    this.baseUrl = normalizeControlPlaneUrl(options.baseUrl);
    this.runnerId = options.runnerId;
    this.privateKey = options.privateKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.nonce = options.nonce ?? (() => randomBytes(24).toString("base64url"));
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? 30_000, "requestTimeoutMs");
  }

  async claim(input: RunnerClaimRequest): Promise<RunnerClaimResponse> {
    return runnerClaimResponseSchema.parse(await this.signedJson("/api/v1/runner/jobs/claim", input));
  }

  async heartbeat(input: RunnerLeaseHeartbeatRequest) {
    return runnerLeaseHeartbeatResponseSchema.parse(
      await this.signedJson("/api/v1/runner/leases/heartbeat", input, leaseContext(input)),
    );
  }

  async relinquish(input: RunnerLeaseRelinquishRequest) {
    return runnerMutationResponseSchema.parse(
      await this.signedJson("/api/v1/runner/leases/relinquish", input, leaseContext(input)),
    );
  }

  async issueArtifactCapabilities(input: RunnerArtifactCapabilityRequest): Promise<RunnerArtifactCapabilityResponse> {
    return runnerArtifactCapabilityResponseSchema.parse(
      await this.signedJson("/api/v1/runner/artifacts/capabilities", input, leaseContext(input)),
    );
  }

  async publishTerminalResult(input: RunnerTerminalResultRequest): Promise<unknown> {
    return await this.signedJson("/api/v1/runner/results", input, leaseContext(input));
  }

  async uploadArtifact(uploadUrl: string, filePath: string, maximumBytes: number): Promise<void> {
    const url = normalizeUploadUrl(uploadUrl);
    const content = await readFile(filePath);
    if (content.byteLength !== maximumBytes) {
      throw new Error(`artifact size changed before upload: expected ${maximumBytes}, received ${content.byteLength}`);
    }
    const response = await this.fetchImpl(url, {
      method: "PUT",
      redirect: "error",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(content.byteLength),
      },
      body: content,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const body = await boundedResponseText(response);
    if (!response.ok) {
      throw new RunnerControlPlaneError(`artifact upload failed with HTTP ${response.status}`, response.status, body);
    }
  }

  private async signedJson(path: string, value: unknown, context: RunnerSignedRequestContext = {}): Promise<unknown> {
    const target = new URL(path, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) {
      throw new Error("runner request path escaped the configured control-plane origin");
    }
    const body = JSON.stringify(value);
    const timestamp = Math.floor(this.now().valueOf() / 1000);
    const nonce = this.nonce();
    const canonicalPath = `${target.pathname}${target.search}`;
    const signature = signRunnerRequest({
      method: "POST",
      path: canonicalPath,
      timestamp,
      nonce,
      workerClass: "self_hosted",
      runnerId: this.runnerId,
      body,
      privateKey: this.privateKey,
      ...context,
    });
    const response = await this.fetchImpl(target, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body, "utf8")),
        [runnerProtocolHeaderNames.protocolVersion]: "1",
        [runnerProtocolHeaderNames.algorithm]: "ed25519",
        [runnerProtocolHeaderNames.workerClass]: "self_hosted",
        [runnerProtocolHeaderNames.runnerId]: this.runnerId,
        [runnerProtocolHeaderNames.timestamp]: String(timestamp),
        [runnerProtocolHeaderNames.nonce]: nonce,
        [runnerProtocolHeaderNames.signature]: signature,
      },
      body,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const responseBody = await boundedResponseText(response);
    if (!response.ok) {
      throw new RunnerControlPlaneError(
        `runner control-plane request failed with HTTP ${response.status}`,
        response.status,
        responseBody,
      );
    }
    if (responseBody.length === 0) return {};
    try {
      return JSON.parse(responseBody) as unknown;
    } catch {
      throw new RunnerControlPlaneError(
        "runner control-plane response was not valid JSON",
        response.status,
        responseBody,
      );
    }
  }
}

export async function activateRunner(input: ActivateRunnerInput): Promise<RunnerRegistrationActivationResponse> {
  const baseUrl = normalizeControlPlaneUrl(input.baseUrl);
  const fetchImpl = input.fetch ?? fetch;
  const requestTimeoutMs = positiveInteger(input.requestTimeoutMs ?? 30_000, "requestTimeoutMs");
  const body = JSON.stringify({
    protocolVersion: 1,
    enrollmentToken: input.enrollmentToken,
    algorithm: "ed25519",
    publicKey: input.publicKey,
    capabilities: [...input.capabilities],
  });
  const response = await fetchImpl(new URL("/api/v1/runner/registrations/activate", baseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body, "utf8")),
    },
    body,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const responseBody = await boundedResponseText(response);
  if (!response.ok) {
    throw new RunnerControlPlaneError(
      `runner activation failed with HTTP ${response.status}`,
      response.status,
      responseBody,
    );
  }
  try {
    return runnerRegistrationActivationResponseSchema.parse(JSON.parse(responseBody) as unknown);
  } catch {
    throw new RunnerControlPlaneError("runner activation response was invalid", response.status, responseBody);
  }
}

export async function loadRunnerPrivateKey(filePath: string): Promise<KeyLike> {
  return createPrivateKey(await readFile(filePath, "utf8"));
}

export function normalizeControlPlaneUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("runner control-plane URL is invalid");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("runner control-plane URL cannot include credentials, a query, or a fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("runner control-plane URL must be an origin without a path");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("runner control-plane URL must use HTTPS; HTTP is allowed only for loopback testing");
  }
  url.pathname = "/";
  return url;
}

function normalizeUploadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("artifact upload URL is invalid");
  }
  if (url.username || url.password || url.hash || url.protocol !== "https:") {
    throw new Error("artifact upload URL must be credential-free HTTPS");
  }
  return url;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function leaseContext(input: {
  runId: string;
  executionAttemptId: string;
  leaseId: string;
}): RunnerSignedRequestContext {
  return {
    runId: input.runId,
    executionAttemptId: input.executionAttemptId,
    leaseId: input.leaseId,
  };
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > responseBodyLimitBytes) {
    throw new Error("runner control-plane response exceeded the maximum permitted size");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > responseBodyLimitBytes) {
    throw new Error("runner control-plane response exceeded the maximum permitted size");
  }
  return body;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
