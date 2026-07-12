import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RunnerWorkerIdentity =
  | { workerClass: "managed"; managedRunnerIdentityId: string }
  | { workerClass: "self_hosted"; runnerRegistrationId: string };

export type RunnerLeaseStoreOptions = {
  now?: () => Date;
  id?: () => string;
  leaseToken?: () => string;
  leaseDurationSeconds?: number;
  maximumLeaseDurationSeconds?: number;
  requestToleranceSeconds?: number;
  requestNonceTtlSeconds?: number;
  emptyRetryAfterSeconds?: number;
};

export type RunnerSignedMutation = {
  requestTimestamp: number;
  requestNonce: string;
};

export type ClaimRunnerJobInput = RunnerWorkerIdentity &
  RunnerSignedMutation & {
    capabilities?: readonly string[];
  };

export type ClaimedRunnerJob = {
  status: "claimed";
  leaseId: string;
  leaseToken: string;
  runId: string;
  executionAttemptId: string;
  leaseExpiresAt: string;
  maximumLeaseExpiresAt: string;
  sourceMode: "broker" | "customer_checkout";
  repository: {
    owner: string;
    name: string;
    commitSha: string;
    private: boolean;
  };
  safeMode: {
    enabled: boolean;
    reasons: readonly "private-repository"[];
  };
};

export type ClaimRunnerJobResult =
  | ClaimedRunnerJob
  | { status: "empty"; retryAfterSeconds: number }
  | { status: "replayed" }
  | { status: "rejected"; reason: "invalid_request" | "stale_request" };

export type RunnerLeaseStage = "claimed" | "preparing_source" | "reporting" | "running" | "uploading_artifacts";

export type RunnerLeaseMutationContext = RunnerWorkerIdentity &
  RunnerSignedMutation & {
    runId: string;
    executionAttemptId: string;
    leaseId: string;
    leaseToken: string;
  };

export type HeartbeatRunnerLeaseInput = RunnerLeaseMutationContext & {
  stage: RunnerLeaseStage;
  progressPercent?: number;
  message?: string;
};

export type HeartbeatRunnerLeaseResult =
  | { status: "active"; leaseExpiresAt: string; maximumLeaseExpiresAt: string }
  | { status: "completed" | "expired" | "replayed" | "revoked" | "stale" };

export type RelinquishRunnerLeaseInput = RunnerLeaseMutationContext & {
  reason: "capacity" | "job_error" | "operator" | "shutdown";
  message?: string;
};

export type RelinquishRunnerLeaseResult = { status: "accepted" | "replayed" | "stale" };

export type RunnerLeaseStore = {
  claimJob(input: ClaimRunnerJobInput): Promise<ClaimRunnerJobResult>;
  heartbeat(input: HeartbeatRunnerLeaseInput): Promise<HeartbeatRunnerLeaseResult>;
  relinquish(input: RelinquishRunnerLeaseInput): Promise<RelinquishRunnerLeaseResult>;
  expireLeases(): Promise<number>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const capabilityPattern = /^[a-z0-9][a-z0-9._:-]*$/u;
const leaseStages = new Set<RunnerLeaseStage>([
  "claimed",
  "preparing_source",
  "running",
  "uploading_artifacts",
  "reporting",
]);

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function booleanColumn(row: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = row?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberColumn(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

function isoColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
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

function validSignedMutation(input: RunnerSignedMutation, now: Date, toleranceSeconds: number): boolean {
  if (!Number.isSafeInteger(input.requestTimestamp) || input.requestTimestamp < 0) return false;
  if (input.requestNonce.length < 22 || input.requestNonce.length > 128) return false;
  if (!base64UrlPattern.test(input.requestNonce)) return false;
  return Math.abs(Math.floor(now.valueOf() / 1000) - input.requestTimestamp) <= toleranceSeconds;
}

function validLeaseContext(input: RunnerLeaseMutationContext): boolean {
  return (
    validIdentity(input) &&
    uuidPattern.test(input.runId) &&
    uuidPattern.test(input.executionAttemptId) &&
    uuidPattern.test(input.leaseId) &&
    input.leaseToken.length >= 43 &&
    input.leaseToken.length <= 256 &&
    base64UrlPattern.test(input.leaseToken)
  );
}

function normalizedCapabilities(capabilities: readonly string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set(capabilities ?? [])).sort();
  if (normalized.length > 64 || normalized.some((capability) => !capabilityPattern.test(capability))) {
    return undefined;
  }
  return normalized;
}

export function createSqlRunnerLeaseStore(
  executor: SqlQueryExecutor,
  options: RunnerLeaseStoreOptions = {},
): RunnerLeaseStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const leaseToken = options.leaseToken ?? (() => randomBytes(32).toString("base64url"));
  const leaseDurationSeconds = positiveInteger(options.leaseDurationSeconds, 120, "leaseDurationSeconds");
  const maximumLeaseDurationSeconds = positiveInteger(
    options.maximumLeaseDurationSeconds,
    1800,
    "maximumLeaseDurationSeconds",
  );
  const requestToleranceSeconds = positiveInteger(options.requestToleranceSeconds, 300, "requestToleranceSeconds");
  const requestNonceTtlSeconds = positiveInteger(options.requestNonceTtlSeconds, 600, "requestNonceTtlSeconds");
  const emptyRetryAfterSeconds = positiveInteger(options.emptyRetryAfterSeconds, 15, "emptyRetryAfterSeconds");

  if (maximumLeaseDurationSeconds < leaseDurationSeconds) {
    throw new Error("maximumLeaseDurationSeconds must be greater than or equal to leaseDurationSeconds");
  }

  async function pruneExpiredNonces(at: Date): Promise<void> {
    await executor.query("delete from runner_request_nonces where expires_at <= $1::timestamptz", [at.toISOString()]);
  }

  async function expireLeasesAt(at: Date): Promise<number> {
    const result = await executor.query("select boardreadyops_expire_runner_leases($1::timestamptz) as expired_count", [
      at.toISOString(),
    ]);
    return numberColumn(rows(result)[0], "expired_count") ?? 0;
  }

  return {
    async expireLeases() {
      const at = now();
      await pruneExpiredNonces(at);
      return await expireLeasesAt(at);
    },

    async claimJob(input) {
      const at = now();
      const capabilities = normalizedCapabilities(input.capabilities);
      if (!validIdentity(input) || capabilities === undefined) {
        return { status: "rejected", reason: "invalid_request" };
      }
      if (!validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "rejected", reason: "stale_request" };
      }

      await pruneExpiredNonces(at);
      await expireLeasesAt(at);

      const attemptId = id();
      const leaseId = id();
      const token = leaseToken();
      if (
        !uuidPattern.test(attemptId) ||
        !uuidPattern.test(leaseId) ||
        token.length < 43 ||
        token.length > 256 ||
        !base64UrlPattern.test(token)
      ) {
        throw new Error("runner lease identity generator returned an invalid value");
      }

      const expiresAt = new Date(at.valueOf() + leaseDurationSeconds * 1000);
      const maximumExpiresAt = new Date(at.valueOf() + maximumLeaseDurationSeconds * 1000);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);

      const result = await executor.query(
        `select * from boardreadyops_claim_runner_job(
           $1::timestamptz, $2, $3, $4, $5::jsonb, $6, $7::timestamptz,
           $8::timestamptz, $9, $10, $11, $12::timestamptz, $13::timestamptz
         )`,
        [
          at.toISOString(),
          workerClass,
          runnerRegistrationId,
          managedRunnerIdentityId,
          JSON.stringify(capabilities),
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          attemptId,
          leaseId,
          digest(token),
          expiresAt.toISOString(),
          maximumExpiresAt.toISOString(),
        ],
      );

      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      if (outcome === "replayed") return { status: "replayed" };
      if (outcome !== "claimed") return { status: "empty", retryAfterSeconds: emptyRetryAfterSeconds };

      const returnedLeaseId = stringColumn(row, "lease_id");
      const runId = stringColumn(row, "run_id");
      const executionAttemptId = stringColumn(row, "execution_attempt_id");
      const leaseExpiresAt = isoColumn(row, "expires_at");
      const maximumLeaseExpiresAt = isoColumn(row, "maximum_expires_at");
      const owner = stringColumn(row, "repository_owner");
      const name = stringColumn(row, "repository_name");
      const commitSha = stringColumn(row, "commit_sha");
      const privateRepository = booleanColumn(row, "repository_private");
      if (
        !returnedLeaseId ||
        !runId ||
        !executionAttemptId ||
        !leaseExpiresAt ||
        !maximumLeaseExpiresAt ||
        !owner ||
        !name ||
        !commitSha ||
        privateRepository === undefined
      ) {
        throw new Error("runner claim did not return a complete lease record");
      }

      return {
        status: "claimed",
        leaseId: returnedLeaseId,
        leaseToken: token,
        runId,
        executionAttemptId,
        leaseExpiresAt,
        maximumLeaseExpiresAt,
        sourceMode: input.workerClass === "managed" ? "broker" : "customer_checkout",
        repository: { owner, name, commitSha, private: privateRepository },
        safeMode: {
          enabled: privateRepository,
          reasons: privateRepository ? ["private-repository"] : [],
        },
      };
    },

    async heartbeat(input) {
      const at = now();
      if (!validLeaseContext(input) || !validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "stale" };
      }
      if (!leaseStages.has(input.stage)) return { status: "stale" };
      if (input.progressPercent !== undefined && !Number.isInteger(input.progressPercent)) {
        return { status: "stale" };
      }
      if (input.progressPercent !== undefined && (input.progressPercent < 0 || input.progressPercent > 100)) {
        return { status: "stale" };
      }
      if (input.message !== undefined && (input.message.trim().length === 0 || input.message.length > 500)) {
        return { status: "stale" };
      }

      await pruneExpiredNonces(at);
      await expireLeasesAt(at);

      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const extensionExpiresAt = new Date(at.valueOf() + leaseDurationSeconds * 1000);

      const result = await executor.query(
        `select * from boardreadyops_heartbeat_runner_lease(
           $1::timestamptz, $2, $3, $4, $5, $6, $7, $8,
           $9::timestamptz, $10::timestamptz, $11::timestamptz,
           $12, $13::integer, $14, $15
         )`,
        [
          at.toISOString(),
          workerClass,
          input.runId,
          input.executionAttemptId,
          input.leaseId,
          runnerRegistrationId,
          managedRunnerIdentityId,
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          extensionExpiresAt.toISOString(),
          input.stage,
          input.progressPercent ?? null,
          input.message?.trim() ?? null,
          digest(input.leaseToken),
        ],
      );

      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      if (outcome === "active") {
        const leaseExpiresAt = isoColumn(row, "expires_at");
        const maximumLeaseExpiresAt = isoColumn(row, "maximum_expires_at");
        if (!leaseExpiresAt || !maximumLeaseExpiresAt) {
          throw new Error("lease heartbeat returned invalid expiry data");
        }
        return { status: "active", leaseExpiresAt, maximumLeaseExpiresAt };
      }
      if (outcome === "completed" || outcome === "expired" || outcome === "replayed" || outcome === "revoked") {
        return { status: outcome };
      }
      return { status: "stale" };
    },

    async relinquish(input) {
      const at = now();
      if (!validLeaseContext(input) || !validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "stale" };
      }
      if (input.message !== undefined && (input.message.trim().length === 0 || input.message.length > 1000)) {
        return { status: "stale" };
      }

      await pruneExpiredNonces(at);
      await expireLeasesAt(at);

      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const attemptStatus = input.reason === "job_error" ? "failed" : "stale";
      const defaultMessage = `Runner relinquished the lease: ${input.reason}.`;

      const result = await executor.query(
        `select boardreadyops_relinquish_runner_lease(
           $1::timestamptz, $2, $3, $4, $5, $6, $7, $8,
           $9::timestamptz, $10::timestamptz, $11, $12, $13, $14, $15
         ) as outcome`,
        [
          at.toISOString(),
          workerClass,
          input.runId,
          input.executionAttemptId,
          input.leaseId,
          runnerRegistrationId,
          managedRunnerIdentityId,
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          input.message?.trim() ?? null,
          defaultMessage,
          digest(input.leaseToken),
          attemptStatus,
          input.reason,
        ],
      );

      const outcome = stringColumn(rows(result)[0], "outcome");
      return outcome === "accepted" || outcome === "replayed" ? { status: outcome } : { status: "stale" };
    },
  };
}
