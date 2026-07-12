import { verifyRunnerRequestSignature } from "@boardreadyops/cloud-core";
import { type RunnerSignedRequestEnvelope, runnerSignedRequestEnvelopeSchema } from "@boardreadyops/contracts";
import type { SqlQueryExecutor, SqlQueryResult } from "@boardreadyops/db/lifecycle-store";

export const runnerProtocolHeaderNames = {
  protocolVersion: "x-boardreadyops-runner-protocol-version",
  algorithm: "x-boardreadyops-runner-algorithm",
  workerClass: "x-boardreadyops-runner-worker-class",
  runnerId: "x-boardreadyops-runner-id",
  timestamp: "x-boardreadyops-runner-timestamp",
  nonce: "x-boardreadyops-runner-nonce",
  signature: "x-boardreadyops-runner-signature",
} as const;

type RunnerRequestIdentity =
  | { workerClass: "managed"; managedRunnerIdentityId: string }
  | { workerClass: "self_hosted"; runnerRegistrationId: string };

type RunnerRequestSignatureContext = {
  runId?: string;
  executionAttemptId?: string;
  leaseId?: string;
};

type AuthenticatedRunnerRequest = {
  envelope: RunnerSignedRequestEnvelope;
  identity: RunnerRequestIdentity;
};

type AuthenticateRunnerRequestInput = {
  request: Request;
  body: string;
  executor: SqlQueryExecutor;
  context?: RunnerRequestSignatureContext;
  now?: Date;
  toleranceSeconds?: number;
};

const defaultToleranceSeconds = 5 * 60;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : undefined;
}

function parseRunnerSignedRequestEnvelope(headers: Headers): RunnerSignedRequestEnvelope | undefined {
  const protocolVersion = numericHeader(headers, runnerProtocolHeaderNames.protocolVersion);
  const timestamp = numericHeader(headers, runnerProtocolHeaderNames.timestamp);
  const parsed = runnerSignedRequestEnvelopeSchema.safeParse({
    protocolVersion,
    algorithm: headers.get(runnerProtocolHeaderNames.algorithm) ?? undefined,
    workerClass: headers.get(runnerProtocolHeaderNames.workerClass) ?? undefined,
    runnerId: headers.get(runnerProtocolHeaderNames.runnerId) ?? undefined,
    timestamp,
    nonce: headers.get(runnerProtocolHeaderNames.nonce) ?? undefined,
    signature: headers.get(runnerProtocolHeaderNames.signature) ?? undefined,
  });
  return parsed.success ? parsed.data : undefined;
}

async function verificationKey(
  executor: SqlQueryExecutor,
  envelope: RunnerSignedRequestEnvelope,
): Promise<string | undefined> {
  const result =
    envelope.workerClass === "managed"
      ? await executor.query(
          `select public_key
           from managed_runner_identities
           where id = $1
             and signing_algorithm = 'ed25519'
             and status = 'active'
             and disabled_at is null
             and public_key is not null`,
          [envelope.runnerId],
        )
      : await executor.query(
          `select public_key
           from runner_registrations
           where id = $1
             and signing_algorithm = 'ed25519'
             and status = 'active'
             and disabled_at is null
             and public_key is not null`,
          [envelope.runnerId],
        );
  return stringColumn(rows(result)[0], "public_key");
}

function canonicalPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export async function authenticateRunnerRequest(
  input: AuthenticateRunnerRequestInput,
): Promise<AuthenticatedRunnerRequest | undefined> {
  const envelope = parseRunnerSignedRequestEnvelope(input.request.headers);
  if (!envelope) return undefined;

  const toleranceSeconds = input.toleranceSeconds ?? defaultToleranceSeconds;
  if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds <= 0) return undefined;
  const now = input.now ?? new Date();
  if (Math.abs(Math.floor(now.valueOf() / 1000) - envelope.timestamp) > toleranceSeconds) return undefined;

  const publicKey = await verificationKey(input.executor, envelope);
  if (!publicKey) return undefined;

  const context = input.context ?? {};
  const verified = verifyRunnerRequestSignature({
    method: input.request.method,
    path: canonicalPath(input.request),
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    workerClass: envelope.workerClass,
    runnerId: envelope.runnerId,
    body: input.body,
    publicKey,
    signature: envelope.signature,
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    ...(context.executionAttemptId === undefined ? {} : { executionAttemptId: context.executionAttemptId }),
    ...(context.leaseId === undefined ? {} : { leaseId: context.leaseId }),
  });
  if (!verified) return undefined;

  return {
    envelope,
    identity:
      envelope.workerClass === "managed"
        ? { workerClass: "managed", managedRunnerIdentityId: envelope.runnerId }
        : { workerClass: "self_hosted", runnerRegistrationId: envelope.runnerId },
  };
}
