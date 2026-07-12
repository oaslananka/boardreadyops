import { createHash } from "node:crypto";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";
import type { RunnerLeaseMutationContext, RunnerWorkerIdentity } from "./runner-lease-store.js";

export type AuthorizeRunnerTerminalResultInput = RunnerLeaseMutationContext & {
  requestBody: string;
};

export type AuthorizeRunnerTerminalResultResult = {
  status: "accepted" | "conflicting_replay" | "replayed" | "stale";
};

export type RunnerTerminalResultAuthorizer = {
  authorize(input: AuthorizeRunnerTerminalResultInput): Promise<AuthorizeRunnerTerminalResultResult>;
};

export type RunnerTerminalResultAuthorizerOptions = {
  now?: () => Date;
  requestToleranceSeconds?: number;
  requestNonceTtlSeconds?: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const maximumRequestBodyBytes = 1024 * 1024;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return selected;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function identityParameters(identity: RunnerWorkerIdentity): [string, string | null, string | null] {
  return identity.workerClass === "managed"
    ? ["managed", null, identity.managedRunnerIdentityId]
    : ["self_hosted", identity.runnerRegistrationId, null];
}

function validIdentity(identity: RunnerWorkerIdentity): boolean {
  return identity.workerClass === "managed"
    ? uuidPattern.test(identity.managedRunnerIdentityId)
    : uuidPattern.test(identity.runnerRegistrationId);
}

function validSecret(value: string): boolean {
  return value.length >= 43 && value.length <= 256 && base64UrlPattern.test(value);
}

function validInput(input: AuthorizeRunnerTerminalResultInput, now: Date, toleranceSeconds: number): boolean {
  return (
    validIdentity(input) &&
    uuidPattern.test(input.runId) &&
    uuidPattern.test(input.executionAttemptId) &&
    uuidPattern.test(input.leaseId) &&
    validSecret(input.leaseToken) &&
    Number.isSafeInteger(input.requestTimestamp) &&
    input.requestTimestamp >= 0 &&
    input.requestNonce.length >= 22 &&
    input.requestNonce.length <= 128 &&
    base64UrlPattern.test(input.requestNonce) &&
    Buffer.byteLength(input.requestBody, "utf8") <= maximumRequestBodyBytes &&
    Math.abs(Math.floor(now.valueOf() / 1000) - input.requestTimestamp) <= toleranceSeconds
  );
}

export function createSqlRunnerTerminalResultAuthorizer(
  executor: SqlQueryExecutor,
  options: RunnerTerminalResultAuthorizerOptions = {},
): RunnerTerminalResultAuthorizer {
  const now = options.now ?? (() => new Date());
  const requestToleranceSeconds = positiveInteger(options.requestToleranceSeconds, 5 * 60, "requestToleranceSeconds");
  const requestNonceTtlSeconds = positiveInteger(options.requestNonceTtlSeconds, 10 * 60, "requestNonceTtlSeconds");

  return {
    async authorize(input) {
      const at = now();
      if (!validInput(input, at, requestToleranceSeconds)) return { status: "stale" };

      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);

      await executor.query("delete from runner_request_nonces where expires_at <= $1::timestamptz", [at.toISOString()]);
      const result = await executor.query(
        `select boardreadyops_authorize_runner_terminal_result(
           $1::timestamptz,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11::timestamptz,
           $12::timestamptz
         ) as outcome`,
        [
          at.toISOString(),
          workerClass,
          input.runId,
          input.executionAttemptId,
          input.leaseId,
          runnerRegistrationId,
          managedRunnerIdentityId,
          digest(input.leaseToken),
          digest(input.requestNonce),
          digest(input.requestBody),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
        ],
      );
      const outcome = stringColumn(rows(result)[0], "outcome");
      if (outcome === "accepted" || outcome === "conflicting_replay" || outcome === "replayed") {
        return { status: outcome };
      }
      return { status: "stale" };
    },
  };
}
