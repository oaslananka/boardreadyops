import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type ControlPlaneDeadLetterItemType = "job" | "outbox";
export type ControlPlaneReconciliationSubjectType =
  | "execution_attempt"
  | "job"
  | "outbox"
  | "release_run";

export type ControlPlaneDeadLetterItem = {
  itemType: ControlPlaneDeadLetterItemType;
  itemId: string;
  installationId: string;
  repositoryId?: string;
  repositoryFullName?: string;
  releaseRunId?: string;
  executionAttemptId?: string;
  reasonCode: string;
  errorClass?: string;
  attemptCount: number;
  failedAt: string;
  replaySafe: boolean;
};

export type ClaimedControlPlaneReconciliationItem = {
  reconciliationId: string;
  installationId: string;
  repositoryId?: string;
  releaseRunId?: string;
  executionAttemptId?: string;
  subjectType: ControlPlaneReconciliationSubjectType;
  subjectId: string;
  reasonCode: string;
  deadlineAt: string;
  nextCheckAt: string;
  attemptCount: number;
};

export type ControlPlaneSliSnapshot = {
  webhookAcceptanceP95Ms: number;
  lifecycleQueueAgeSeconds: number;
  outboxLagSeconds: number;
  dispatchLatencyP95Seconds: number;
  completionLatencyP95Seconds: number;
  staleAttempts: number;
  reconciliationBacklog: number;
  reconciliationRepairs24h: number;
  terminalFailures24h: number;
  terminalRuns24h: number;
  terminalFailureRateBasisPoints: number;
};

export type ControlPlaneOperationsStore = {
  listDeadLetters(input: {
    installationId: string;
    limit?: number;
    before?: Date;
  }): Promise<ControlPlaneDeadLetterItem[]>;
  replayDeadLetter(input: {
    installationId: string;
    itemType: ControlPlaneDeadLetterItemType;
    itemId: string;
    operationId: string;
    actorId: string;
  }): Promise<{
    outcome: "already_applied" | "not_found" | "not_replayable" | "replayed";
    auditEventId?: string;
  }>;
  enqueueReconciliationItem(input: {
    reconciliationId: string;
    installationId: string;
    repositoryId?: string;
    releaseRunId?: string;
    executionAttemptId?: string;
    subjectType: ControlPlaneReconciliationSubjectType;
    subjectId: string;
    reasonCode: string;
    deadlineAt: Date;
    nextCheckAt?: Date;
    maximumAttempts?: number;
  }): Promise<"enqueued" | "existing">;
  claimReconciliationItems(input: {
    workerId: string;
    limit?: number;
  }): Promise<ClaimedControlPlaneReconciliationItem[]>;
  completeReconciliationItem(input: {
    reconciliationId: string;
    workerId: string;
    outcomeCode: string;
    repaired: boolean;
    publicFailureReason?: string;
  }): Promise<"completed" | "stale">;
  failReconciliationItem(input: {
    reconciliationId: string;
    workerId: string;
    attemptCount: number;
    errorClass: string;
    errorMessage: string;
  }): Promise<"dead_letter" | "retry" | "stale">;
  collectSliSnapshot(input?: { installationId?: string }): Promise<ControlPlaneSliSnapshot>;
};

export type ControlPlaneOperationsStoreOptions = {
  now?: () => Date;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const supportedDeadLetterTypes = new Set<ControlPlaneDeadLetterItemType>(["job", "outbox"]);
const supportedSubjectTypes = new Set<ControlPlaneReconciliationSubjectType>([
  "execution_attempt",
  "job",
  "outbox",
  "release_run",
]);

class DatabaseRow {
  constructor(private readonly value: Record<string, unknown> | undefined) {}

  text(column: string): string | undefined {
    const value = this.value?.[column];
    return typeof value === "string" ? value : undefined;
  }

  integer(column: string): number | undefined {
    const value = this.value?.[column];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
    return undefined;
  }

  boolean(column: string): boolean | undefined {
    const value = this.value?.[column];
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "t") return true;
    if (value === "false" || value === "f") return false;
    return undefined;
  }
}

function databaseRows(result: unknown): DatabaseRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const values = (result as SqlQueryResult).rows;
  return Array.isArray(values) ? values.map((value) => new DatabaseRow(value)) : [];
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${label} must be a positive integer`);
  return selected;
}

function validIdentifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function validReasonCode(value: string, label: string): string {
  if (!reasonCodePattern.test(value) || value.length > 128) throw new Error(`invalid ${label}`);
  return value;
}

function boundedFailure(value: string, maximum: number, fallback: string): string {
  const normalized = value.replace(/[\r\n\t]+/gu, " ").trim();
  return (normalized || fallback).slice(0, maximum);
}

function requiredText(row: DatabaseRow, column: string, label: string): string {
  const value = row.text(column);
  if (!value) throw new Error(`control-plane operations query returned an incomplete ${label}`);
  return value;
}

function decodedDeadLetter(row: DatabaseRow): ControlPlaneDeadLetterItem {
  const itemType = row.text("item_type");
  const attemptCount = row.integer("attempt_count");
  const replaySafe = row.boolean("replay_safe");
  if (
    !itemType ||
    !supportedDeadLetterTypes.has(itemType as ControlPlaneDeadLetterItemType) ||
    attemptCount === undefined ||
    replaySafe === undefined
  ) {
    throw new Error("control-plane operations query returned an incomplete dead letter");
  }
  const repositoryId = row.text("repository_id");
  const repositoryFullName = row.text("repository_full_name");
  const releaseRunId = row.text("release_run_id");
  const executionAttemptId = row.text("execution_attempt_id");
  const errorClass = row.text("error_class");
  return {
    itemType: itemType as ControlPlaneDeadLetterItemType,
    itemId: requiredText(row, "item_id", "dead letter"),
    installationId: requiredText(row, "installation_id", "dead letter"),
    ...(repositoryId ? { repositoryId } : {}),
    ...(repositoryFullName ? { repositoryFullName } : {}),
    ...(releaseRunId ? { releaseRunId } : {}),
    ...(executionAttemptId ? { executionAttemptId } : {}),
    reasonCode: requiredText(row, "reason_code", "dead letter"),
    ...(errorClass ? { errorClass } : {}),
    attemptCount,
    failedAt: requiredText(row, "failed_at", "dead letter"),
    replaySafe,
  };
}

function decodedReconciliationItem(row: DatabaseRow): ClaimedControlPlaneReconciliationItem {
  const subjectType = row.text("subject_type");
  const attemptCount = row.integer("attempt_count");
  if (
    !subjectType ||
    !supportedSubjectTypes.has(subjectType as ControlPlaneReconciliationSubjectType) ||
    attemptCount === undefined
  ) {
    throw new Error("control-plane reconciliation claim returned an incomplete item");
  }
  const repositoryId = row.text("repository_id");
  const releaseRunId = row.text("release_run_id");
  const executionAttemptId = row.text("execution_attempt_id");
  return {
    reconciliationId: requiredText(row, "reconciliation_id", "reconciliation item"),
    installationId: requiredText(row, "installation_id", "reconciliation item"),
    ...(repositoryId ? { repositoryId } : {}),
    ...(releaseRunId ? { releaseRunId } : {}),
    ...(executionAttemptId ? { executionAttemptId } : {}),
    subjectType: subjectType as ControlPlaneReconciliationSubjectType,
    subjectId: requiredText(row, "subject_id", "reconciliation item"),
    reasonCode: requiredText(row, "reason_code", "reconciliation item"),
    deadlineAt: requiredText(row, "deadline_at", "reconciliation item"),
    nextCheckAt: requiredText(row, "next_check_at", "reconciliation item"),
    attemptCount,
  };
}

function decodedSliSnapshot(row: DatabaseRow | undefined): ControlPlaneSliSnapshot {
  return {
    webhookAcceptanceP95Ms: row?.integer("webhook_acceptance_p95_ms") ?? 0,
    lifecycleQueueAgeSeconds: row?.integer("lifecycle_queue_age_seconds") ?? 0,
    outboxLagSeconds: row?.integer("outbox_lag_seconds") ?? 0,
    dispatchLatencyP95Seconds: row?.integer("dispatch_latency_p95_seconds") ?? 0,
    completionLatencyP95Seconds: row?.integer("completion_latency_p95_seconds") ?? 0,
    staleAttempts: row?.integer("stale_attempts") ?? 0,
    reconciliationBacklog: row?.integer("reconciliation_backlog") ?? 0,
    reconciliationRepairs24h: row?.integer("reconciliation_repairs_24h") ?? 0,
    terminalFailures24h: row?.integer("terminal_failures_24h") ?? 0,
    terminalRuns24h: row?.integer("terminal_runs_24h") ?? 0,
    terminalFailureRateBasisPoints: row?.integer("terminal_failure_rate_basis_points") ?? 0,
  };
}

export function createSqlControlPlaneOperationsStore(
  executor: SqlQueryExecutor,
  options: ControlPlaneOperationsStoreOptions = {},
): ControlPlaneOperationsStore {
  const now = options.now ?? (() => new Date());
  const leaseSeconds = positiveInteger(options.leaseSeconds, 120, "leaseSeconds");
  const retryBaseSeconds = positiveInteger(options.retryBaseSeconds, 30, "retryBaseSeconds");

  return {
    async listDeadLetters(input) {
      validIdentifier(input.installationId, "installation id");
      const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
      const result = await executor.query(
        "select * from boardreadyops_list_control_plane_dead_letters($1, $2::integer, $3::timestamptz)",
        [input.installationId, limit, input.before?.toISOString() ?? null],
      );
      return databaseRows(result).map(decodedDeadLetter);
    },

    async replayDeadLetter(input) {
      validIdentifier(input.installationId, "installation id");
      validIdentifier(input.itemId, "dead-letter item id");
      validIdentifier(input.operationId, "operation id");
      validIdentifier(input.actorId, "actor id");
      if (!supportedDeadLetterTypes.has(input.itemType)) throw new Error("invalid dead-letter item type");
      const result = await executor.query(
        `select * from boardreadyops_replay_control_plane_dead_letter(
           $1, $2, $3, $4, $5, $6::timestamptz
         )`,
        [input.installationId, input.itemType, input.itemId, input.operationId, input.actorId, now().toISOString()],
      );
      const row = databaseRows(result)[0];
      const outcome = row?.text("outcome");
      const auditEventId = row?.text("audit_event_id");
      if (
        outcome !== "already_applied" &&
        outcome !== "not_found" &&
        outcome !== "not_replayable" &&
        outcome !== "replayed"
      ) {
        throw new Error("dead-letter replay returned an invalid outcome");
      }
      return { outcome, ...(auditEventId ? { auditEventId } : {}) };
    },

    async enqueueReconciliationItem(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.installationId, "installation id");
      if (input.repositoryId) validIdentifier(input.repositoryId, "repository id");
      if (input.releaseRunId) validIdentifier(input.releaseRunId, "release run id");
      if (input.executionAttemptId) validIdentifier(input.executionAttemptId, "execution attempt id");
      validIdentifier(input.subjectId, "reconciliation subject id");
      if (!supportedSubjectTypes.has(input.subjectType)) throw new Error("invalid reconciliation subject type");
      validReasonCode(input.reasonCode, "reconciliation reason code");
      const maximumAttempts = Math.max(1, Math.min(input.maximumAttempts ?? 12, 100));
      const result = await executor.query(
        `select boardreadyops_enqueue_control_plane_reconciliation(
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9::timestamptz, $10::timestamptz, $11::integer, $12::timestamptz
         ) as outcome`,
        [
          input.reconciliationId,
          input.installationId,
          input.repositoryId ?? null,
          input.releaseRunId ?? null,
          input.executionAttemptId ?? null,
          input.subjectType,
          input.subjectId,
          input.reasonCode,
          input.deadlineAt.toISOString(),
          (input.nextCheckAt ?? now()).toISOString(),
          maximumAttempts,
          now().toISOString(),
        ],
      );
      return databaseRows(result)[0]?.text("outcome") === "enqueued" ? "enqueued" : "existing";
    },

    async claimReconciliationItems(input) {
      validIdentifier(input.workerId, "reconciliation worker id");
      const claimedAt = now();
      const leaseExpiresAt = new Date(claimedAt.valueOf() + leaseSeconds * 1000);
      const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
      const result = await executor.query(
        `select * from boardreadyops_claim_control_plane_reconciliation(
           $1, $2::timestamptz, $3::timestamptz, $4::integer
         )`,
        [input.workerId, claimedAt.toISOString(), leaseExpiresAt.toISOString(), limit],
      );
      return databaseRows(result).map(decodedReconciliationItem);
    },

    async completeReconciliationItem(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      validReasonCode(input.outcomeCode, "reconciliation outcome code");
      const result = await executor.query(
        `select boardreadyops_complete_control_plane_reconciliation(
           $1, $2, $3::timestamptz, $4, $5::boolean, $6
         ) as outcome`,
        [
          input.reconciliationId,
          input.workerId,
          now().toISOString(),
          input.outcomeCode,
          input.repaired,
          input.publicFailureReason
            ? boundedFailure(input.publicFailureReason, 256, "operator_replay_required")
            : null,
        ],
      );
      return databaseRows(result)[0]?.text("outcome") === "completed" ? "completed" : "stale";
    },

    async failReconciliationItem(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      const attemptCount = positiveInteger(input.attemptCount, 1, "attemptCount");
      const failedAt = now();
      const retrySeconds = Math.min(3600, retryBaseSeconds * 2 ** Math.min(attemptCount - 1, 8));
      const retryAt = new Date(failedAt.valueOf() + retrySeconds * 1000);
      const result = await executor.query(
        `select boardreadyops_fail_control_plane_reconciliation(
           $1, $2, $3::timestamptz, $4::timestamptz, $5, $6
         ) as outcome`,
        [
          input.reconciliationId,
          input.workerId,
          failedAt.toISOString(),
          retryAt.toISOString(),
          boundedFailure(input.errorClass, 100, "unclassified"),
          boundedFailure(input.errorMessage, 1000, "Control-plane reconciliation failed."),
        ],
      );
      const outcome = databaseRows(result)[0]?.text("outcome");
      return outcome === "retry" || outcome === "dead_letter" ? outcome : "stale";
    },

    async collectSliSnapshot(input = {}) {
      if (input.installationId) validIdentifier(input.installationId, "installation id");
      const result = await executor.query(
        "select * from boardreadyops_control_plane_sli_snapshot($1, $2::timestamptz)",
        [input.installationId ?? null, now().toISOString()],
      );
      return decodedSliSnapshot(databaseRows(result)[0]);
    },
  };
}
