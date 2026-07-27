import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type ReleaseRunTransitionStatus =
  | "cancelled"
  | "completed"
  | "dispatched"
  | "failed"
  | "queued"
  | "running"
  | "superseded"
  | "timed_out";

export type ReleaseRunAttemptTransitionStatus =
  | "cancelled"
  | "completed"
  | "dispatched"
  | "dispatching"
  | "failed"
  | "in_progress"
  | "queued"
  | "reporting"
  | "stale"
  | "superseded"
  | "timed_out"
  | "uploading_artifacts";

export type ReleaseRunTransitionOutcome = "applied" | "invalid_transition" | "not_found" | "stale";

export type ReleaseRunTransitionInput = {
  releaseRunId: string;
  expectedRunStatus: ReleaseRunTransitionStatus;
  expectedRunVersion: number;
  expectedExecutionAttemptId?: string;
  expectedAttemptStatus?: ReleaseRunAttemptTransitionStatus;
  expectedAttemptVersion?: number;
  nextRunStatus: ReleaseRunTransitionStatus;
  nextAttemptStatus?: ReleaseRunAttemptTransitionStatus;
  reasonCode: string;
  transitionedAt: Date;
};

export type ReleaseRunTransitionResult = {
  outcome: ReleaseRunTransitionOutcome;
  runStatus?: ReleaseRunTransitionStatus;
  runVersion?: number;
  attemptStatus?: ReleaseRunAttemptTransitionStatus;
  attemptVersion?: number;
};

export type ControlPlaneRunTransitionStore = {
  transition(input: ReleaseRunTransitionInput): Promise<ReleaseRunTransitionResult>;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const runStatuses = new Set<ReleaseRunTransitionStatus>([
  "cancelled",
  "completed",
  "dispatched",
  "failed",
  "queued",
  "running",
  "superseded",
  "timed_out",
]);
const attemptStatuses = new Set<ReleaseRunAttemptTransitionStatus>([
  "cancelled",
  "completed",
  "dispatched",
  "dispatching",
  "failed",
  "in_progress",
  "queued",
  "reporting",
  "stale",
  "superseded",
  "timed_out",
  "uploading_artifacts",
]);
const outcomes = new Set<ReleaseRunTransitionOutcome>(["applied", "invalid_transition", "not_found", "stale"]);

function validIdentifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function validRunStatus(value: string, label: string): ReleaseRunTransitionStatus {
  if (!runStatuses.has(value as ReleaseRunTransitionStatus)) throw new Error(`unsupported ${label}`);
  return value as ReleaseRunTransitionStatus;
}

function validAttemptStatus(value: string, label: string): ReleaseRunAttemptTransitionStatus {
  if (!attemptStatuses.has(value as ReleaseRunAttemptTransitionStatus)) throw new Error(`unsupported ${label}`);
  return value as ReleaseRunAttemptTransitionStatus;
}

function validVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validReasonCode(value: string): string {
  if (!reasonCodePattern.test(value) || value.length > 128) throw new Error("invalid transition reason code");
  return value;
}

function validDate(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error("transitionedAt must be a valid date");
  }
  return value.toISOString();
}

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const rows = (result as SqlQueryResult).rows;
  return Array.isArray(rows) ? rows : [];
}

function text(row: Record<string, unknown>, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function version(row: Record<string, unknown>, column: string): number | undefined {
  const value = row[column];
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function decodeResult(result: unknown): ReleaseRunTransitionResult {
  const row = resultRows(result)[0];
  if (!row) throw new Error("invalid run transition result");
  const rawOutcome = text(row, "transition_outcome");
  if (!rawOutcome || !outcomes.has(rawOutcome as ReleaseRunTransitionOutcome)) {
    throw new Error("invalid run transition result");
  }
  const outcome = rawOutcome as ReleaseRunTransitionOutcome;
  if (outcome === "not_found") return { outcome };

  const rawRunStatus = text(row, "run_status");
  const runVersion = version(row, "run_version");
  if (!rawRunStatus || !runStatuses.has(rawRunStatus as ReleaseRunTransitionStatus) || runVersion === undefined) {
    throw new Error("invalid run transition result");
  }

  const rawAttemptStatus = text(row, "attempt_status");
  const attemptVersion = version(row, "attempt_version");
  let attemptResult: Pick<ReleaseRunTransitionResult, "attemptStatus" | "attemptVersion"> = {};
  if (rawAttemptStatus !== undefined || attemptVersion !== undefined) {
    if (
      rawAttemptStatus === undefined ||
      attemptVersion === undefined ||
      !attemptStatuses.has(rawAttemptStatus as ReleaseRunAttemptTransitionStatus)
    ) {
      throw new Error("invalid run transition result");
    }
    attemptResult = {
      attemptStatus: rawAttemptStatus as ReleaseRunAttemptTransitionStatus,
      attemptVersion,
    };
  }

  return {
    outcome,
    runStatus: rawRunStatus as ReleaseRunTransitionStatus,
    runVersion,
    ...attemptResult,
  };
}

export function createControlPlaneRunTransitionStore(executor: SqlQueryExecutor): ControlPlaneRunTransitionStore {
  return {
    async transition(input) {
      const releaseRunId = validIdentifier(input.releaseRunId, "release run id");
      const expectedRunStatus = validRunStatus(input.expectedRunStatus, "expected run status");
      const expectedRunVersion = validVersion(input.expectedRunVersion, "expected run version");
      const nextRunStatus = validRunStatus(input.nextRunStatus, "next run status");
      const reasonCode = validReasonCode(input.reasonCode);
      const transitionTimestamp = validDate(input.transitionedAt);
      const expectedExecutionAttemptId = input.expectedExecutionAttemptId
        ? validIdentifier(input.expectedExecutionAttemptId, "execution attempt id")
        : undefined;

      const attemptTransitionFields = [
        input.expectedAttemptStatus,
        input.expectedAttemptVersion,
        input.nextAttemptStatus,
      ];
      const hasAttemptTransition = attemptTransitionFields.some((value) => value !== undefined);
      const hasCompleteAttemptTransition = attemptTransitionFields.every((value) => value !== undefined);
      if (hasAttemptTransition && (!expectedExecutionAttemptId || !hasCompleteAttemptTransition)) {
        throw new Error("attempt transition requires expected status, expected version, and next status");
      }

      const expectedAttemptStatus = input.expectedAttemptStatus
        ? validAttemptStatus(input.expectedAttemptStatus, "expected attempt status")
        : undefined;
      const expectedAttemptVersion =
        input.expectedAttemptVersion === undefined
          ? undefined
          : validVersion(input.expectedAttemptVersion, "expected attempt version");
      const nextAttemptStatus = input.nextAttemptStatus
        ? validAttemptStatus(input.nextAttemptStatus, "next attempt status")
        : undefined;

      const result = await executor.query(
        `select * from boardreadyops_transition_release_run_state(
           $1,
           $2,
           $3::bigint,
           $4,
           $5,
           $6,
           $7::timestamptz,
           $8,
           $9::bigint,
           $10
         )`,
        [
          releaseRunId,
          expectedRunStatus,
          expectedRunVersion,
          expectedExecutionAttemptId ?? null,
          nextRunStatus,
          reasonCode,
          transitionTimestamp,
          expectedAttemptStatus ?? null,
          expectedAttemptVersion ?? null,
          nextAttemptStatus ?? null,
        ],
      );

      return decodeResult(result);
    },
  };
}
