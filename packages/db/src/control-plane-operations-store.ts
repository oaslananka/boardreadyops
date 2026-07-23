import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type ControlPlaneDeadLetterItemType = "job" | "outbox";
export type ControlPlaneReconciliationSubjectType = "execution_attempt" | "job" | "outbox" | "release_run";

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

export type ControlPlaneWorkflowReconciliationContext = {
  reconciliationId: string;
  installationId: string;
  githubInstallationId: number;
  repositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  releaseRunId: string;
  executionAttemptId: string;
  githubWorkflowRunId: string;
  attemptStatus: string;
  deadlineAt: string;
};

export type ControlPlaneCheckRunReconciliationContext = {
  reconciliationId: string;
  installationId: string;
  githubInstallationId: number;
  repositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  releaseRunId: string;
  commitSha: string;
  githubCheckRunId: number;
  runStatus: string;
  expectedConclusion: "failure" | "neutral" | "success" | "timed_out";
  completedAt: string;
  deadlineAt: string;
};

export type ControlPlaneCheckRunReconciliationAction = "observed_current" | "updated";

export type ControlPlaneWorkflowTerminalStatus = "failed" | "timed_out";

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
  claimWorkflowReconciliationItems(input: {
    workerId: string;
    limit?: number;
  }): Promise<ClaimedControlPlaneReconciliationItem[]>;
  claimCheckRunReconciliationItems(input: {
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
  detectWorkflowReconciliationCandidates(input: {
    observationDelaySeconds: number;
    terminalDeadlineSeconds: number;
    limit?: number;
  }): Promise<number>;
  detectCheckRunReconciliationCandidates(input: {
    observationDelaySeconds: number;
    terminalDeadlineSeconds: number;
    limit?: number;
  }): Promise<number>;
  loadWorkflowReconciliationContext(input: {
    reconciliationId: string;
    workerId: string;
  }): Promise<ControlPlaneWorkflowReconciliationContext | undefined>;
  loadCheckRunReconciliationContext(input: {
    reconciliationId: string;
    workerId: string;
  }): Promise<ControlPlaneCheckRunReconciliationContext | undefined>;
  rescheduleReconciliationItem(input: {
    reconciliationId: string;
    workerId: string;
    nextCheckAt: Date;
    outcomeCode: string;
  }): Promise<"rescheduled" | "stale">;
  applyWorkflowReconciliation(input: {
    reconciliationId: string;
    workerId: string;
    observedStatus: string;
    observedConclusion?: string;
    terminalStatus: ControlPlaneWorkflowTerminalStatus;
    publicFailureReason: string;
  }): Promise<"already_terminal" | "applied" | "stale">;
  applyCheckRunReconciliation(input: {
    reconciliationId: string;
    workerId: string;
    observedStatus: string;
    observedConclusion?: string;
    action: ControlPlaneCheckRunReconciliationAction;
  }): Promise<"already_published" | "applied" | "stale">;
  finalizeCheckRunReconciliationFailure(input: {
    reconciliationId: string;
    workerId: string;
    observedStatus: string;
    observedConclusion?: string;
    publicFailureReason: string;
  }): Promise<"already_published" | "failed" | "stale">;
  collectSliSnapshot(input?: { installationId?: string }): Promise<ControlPlaneSliSnapshot>;
};

export type ControlPlaneOperationsStoreOptions = {
  now?: () => Date;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const credentialAssignmentKeys = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "private-key",
  "private_key",
  "privatekey",
  "secret",
  "token",
] as const;
const bearerPattern = /\bBearer\s+[a-z0-9._~+/=-]+/giu;
const supportedDeadLetterTypes = new Set<ControlPlaneDeadLetterItemType>(["job", "outbox"]);
const supportedSubjectTypes = new Set<ControlPlaneReconciliationSubjectType>([
  "execution_attempt",
  "job",
  "outbox",
  "release_run",
]);

class DatabaseRow {
  constructor(private readonly columns: Record<string, unknown> | undefined) {}

  private column(name: string): unknown {
    return this.columns?.[name];
  }

  text(name: string): string | undefined {
    const candidate = this.column(name);
    if (typeof candidate !== "string") return undefined;
    return candidate;
  }

  integer(name: string): number | undefined {
    const candidate = this.column(name);
    if (typeof candidate === "number") {
      return Number.isSafeInteger(candidate) ? candidate : undefined;
    }
    if (typeof candidate !== "string" || !/^\d+$/u.test(candidate)) return undefined;
    return Number(candidate);
  }

  boolean(name: string): boolean | undefined {
    const candidate = this.column(name);
    if (typeof candidate === "boolean") return candidate;
    if (candidate === "true" || candidate === "t") return true;
    if (candidate === "false" || candidate === "f") return false;
    return undefined;
  }

  timestamp(name: string): string | undefined {
    const candidate = this.column(name);
    if (candidate instanceof Date && Number.isFinite(candidate.valueOf())) {
      return candidate.toISOString();
    }
    if (typeof candidate !== "string") return undefined;
    const parsed = new Date(candidate);
    return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : undefined;
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

function isIdentifierCharacter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.toLowerCase().codePointAt(0) ?? -1;
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || value === "_";
}

function isAssignmentWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function assignmentValueEnd(value: string, start: number): number {
  const quote = value[start];
  if (quote === '"' || quote === "'") {
    const closingQuote = value.indexOf(quote, start + 1);
    return closingQuote === -1 ? value.length : closingQuote + 1;
  }

  let cursor = start;
  while (
    cursor < value.length &&
    !isAssignmentWhitespace(value[cursor]) &&
    value[cursor] !== "," &&
    value[cursor] !== ";"
  ) {
    cursor += 1;
  }
  return cursor;
}

function redactCredentialAssignment(value: string, key: string): string {
  const normalized = value.toLowerCase();
  let searchFrom = 0;
  let copiedUntil = 0;
  let redacted = "";

  while (searchFrom < value.length) {
    const keyIndex = normalized.indexOf(key, searchFrom);
    if (keyIndex === -1) break;

    const keyEnd = keyIndex + key.length;
    if (isIdentifierCharacter(normalized[keyIndex - 1]) || isIdentifierCharacter(normalized[keyEnd])) {
      searchFrom = keyEnd;
      continue;
    }

    let cursor = keyEnd;
    while (isAssignmentWhitespace(value[cursor])) cursor += 1;
    if (value[cursor] !== "=" && value[cursor] !== ":") {
      searchFrom = keyEnd;
      continue;
    }

    cursor += 1;
    while (isAssignmentWhitespace(value[cursor])) cursor += 1;
    const valueEnd = assignmentValueEnd(value, cursor);
    redacted += `${value.slice(copiedUntil, keyIndex)}credential=[REDACTED]`;
    copiedUntil = valueEnd;
    searchFrom = valueEnd;
  }

  return redacted ? redacted + value.slice(copiedUntil) : value;
}

function redactCredentialAssignments(value: string): string {
  return credentialAssignmentKeys.reduce(redactCredentialAssignment, value);
}

function boundedFailure(value: string, maximum: number, fallback: string): string {
  const normalized = redactCredentialAssignments(value.replace(bearerPattern, "Bearer [REDACTED]"))
    .replace(/[\r\n\t]+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximum);
}

function requiredText(row: DatabaseRow, column: string, label: string): string {
  const value = row.text(column);
  if (!value) throw new Error(`control-plane operations query returned an incomplete ${label}`);
  return value;
}

function requiredTimestamp(row: DatabaseRow, column: string, label: string): string {
  const value = row.timestamp(column);
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
    failedAt: requiredTimestamp(row, "failed_at", "dead letter"),
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
    deadlineAt: requiredTimestamp(row, "deadline_at", "reconciliation item"),
    nextCheckAt: requiredTimestamp(row, "next_check_at", "reconciliation item"),
    attemptCount,
  };
}

function decodedWorkflowReconciliationContext(
  row: DatabaseRow | undefined,
): ControlPlaneWorkflowReconciliationContext | undefined {
  if (!row) return undefined;
  const githubInstallationId = row.integer("github_installation_id");
  if (githubInstallationId === undefined) {
    throw new Error("workflow reconciliation context returned an invalid GitHub installation id");
  }
  return {
    reconciliationId: requiredText(row, "reconciliation_id", "workflow reconciliation context"),
    installationId: requiredText(row, "installation_id", "workflow reconciliation context"),
    githubInstallationId,
    repositoryId: requiredText(row, "repository_id", "workflow reconciliation context"),
    repositoryOwner: requiredText(row, "repository_owner", "workflow reconciliation context"),
    repositoryName: requiredText(row, "repository_name", "workflow reconciliation context"),
    repositoryFullName: requiredText(row, "repository_full_name", "workflow reconciliation context"),
    releaseRunId: requiredText(row, "release_run_id", "workflow reconciliation context"),
    executionAttemptId: requiredText(row, "execution_attempt_id", "workflow reconciliation context"),
    githubWorkflowRunId: requiredText(row, "github_workflow_run_id", "workflow reconciliation context"),
    attemptStatus: requiredText(row, "attempt_status", "workflow reconciliation context"),
    deadlineAt: requiredTimestamp(row, "deadline_at", "workflow reconciliation context"),
  };
}

function decodedCheckRunReconciliationContext(
  row: DatabaseRow | undefined,
): ControlPlaneCheckRunReconciliationContext | undefined {
  if (!row) return undefined;
  const githubInstallationId = row.integer("github_installation_id");
  const githubCheckRunId = row.integer("github_check_run_id");
  const expectedConclusion = row.text("expected_conclusion");
  if (githubInstallationId === undefined || githubCheckRunId === undefined) {
    throw new Error("Check Run reconciliation context returned invalid GitHub identifiers");
  }
  if (
    expectedConclusion !== "failure" &&
    expectedConclusion !== "neutral" &&
    expectedConclusion !== "success" &&
    expectedConclusion !== "timed_out"
  ) {
    throw new Error("Check Run reconciliation context returned an invalid expected conclusion");
  }
  return {
    reconciliationId: requiredText(row, "reconciliation_id", "Check Run reconciliation context"),
    installationId: requiredText(row, "installation_id", "Check Run reconciliation context"),
    githubInstallationId,
    repositoryId: requiredText(row, "repository_id", "Check Run reconciliation context"),
    repositoryOwner: requiredText(row, "repository_owner", "Check Run reconciliation context"),
    repositoryName: requiredText(row, "repository_name", "Check Run reconciliation context"),
    repositoryFullName: requiredText(row, "repository_full_name", "Check Run reconciliation context"),
    releaseRunId: requiredText(row, "release_run_id", "Check Run reconciliation context"),
    commitSha: requiredText(row, "commit_sha", "Check Run reconciliation context"),
    githubCheckRunId,
    runStatus: requiredText(row, "run_status", "Check Run reconciliation context"),
    expectedConclusion,
    completedAt: requiredTimestamp(row, "completed_at", "Check Run reconciliation context"),
    deadlineAt: requiredTimestamp(row, "deadline_at", "Check Run reconciliation context"),
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

    async claimWorkflowReconciliationItems(input) {
      validIdentifier(input.workerId, "reconciliation worker id");
      const claimedAt = now();
      const leaseExpiresAt = new Date(claimedAt.valueOf() + leaseSeconds * 1000);
      const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
      const result = await executor.query(
        `select * from boardreadyops_claim_github_workflow_reconciliation(
           $1, $2::timestamptz, $3::timestamptz, $4::integer
         )`,
        [input.workerId, claimedAt.toISOString(), leaseExpiresAt.toISOString(), limit],
      );
      return databaseRows(result).map(decodedReconciliationItem);
    },

    async claimCheckRunReconciliationItems(input) {
      validIdentifier(input.workerId, "reconciliation worker id");
      const claimedAt = now();
      const leaseExpiresAt = new Date(claimedAt.valueOf() + leaseSeconds * 1000);
      const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
      const result = await executor.query(
        `select * from boardreadyops_claim_github_check_run_reconciliation(
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
          input.publicFailureReason ? boundedFailure(input.publicFailureReason, 256, "operator_replay_required") : null,
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

    async detectCheckRunReconciliationCandidates(input) {
      const observationDelaySeconds = positiveInteger(input.observationDelaySeconds, 300, "observationDelaySeconds");
      const terminalDeadlineSeconds = positiveInteger(input.terminalDeadlineSeconds, 1800, "terminalDeadlineSeconds");
      if (terminalDeadlineSeconds <= observationDelaySeconds) {
        throw new Error("terminalDeadlineSeconds must be greater than observationDelaySeconds");
      }
      const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));
      const result = await executor.query(
        `select boardreadyops_detect_github_check_run_reconciliation(
           $1::timestamptz, $2::integer, $3::integer, $4::integer
         ) as detected`,
        [now().toISOString(), observationDelaySeconds, terminalDeadlineSeconds, limit],
      );
      return databaseRows(result)[0]?.integer("detected") ?? 0;
    },

    async detectWorkflowReconciliationCandidates(input) {
      const observationDelaySeconds = positiveInteger(input.observationDelaySeconds, 300, "observationDelaySeconds");
      const terminalDeadlineSeconds = positiveInteger(input.terminalDeadlineSeconds, 1800, "terminalDeadlineSeconds");
      if (terminalDeadlineSeconds <= observationDelaySeconds) {
        throw new Error("terminalDeadlineSeconds must be greater than observationDelaySeconds");
      }
      const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));
      const result = await executor.query(
        `select boardreadyops_detect_github_workflow_reconciliation(
           $1::timestamptz, $2::integer, $3::integer, $4::integer
         ) as detected`,
        [now().toISOString(), observationDelaySeconds, terminalDeadlineSeconds, limit],
      );
      return databaseRows(result)[0]?.integer("detected") ?? 0;
    },

    async loadCheckRunReconciliationContext(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      const result = await executor.query(
        "select * from boardreadyops_github_check_run_reconciliation_context($1, $2)",
        [input.reconciliationId, input.workerId],
      );
      return decodedCheckRunReconciliationContext(databaseRows(result)[0]);
    },

    async loadWorkflowReconciliationContext(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      const result = await executor.query(
        "select * from boardreadyops_github_workflow_reconciliation_context($1, $2)",
        [input.reconciliationId, input.workerId],
      );
      return decodedWorkflowReconciliationContext(databaseRows(result)[0]);
    },

    async rescheduleReconciliationItem(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      validReasonCode(input.outcomeCode, "reconciliation outcome code");
      const result = await executor.query(
        `select boardreadyops_reschedule_github_workflow_reconciliation(
           $1, $2, $3::timestamptz, $4::timestamptz, $5
         ) as outcome`,
        [
          input.reconciliationId,
          input.workerId,
          now().toISOString(),
          input.nextCheckAt.toISOString(),
          input.outcomeCode,
        ],
      );
      return databaseRows(result)[0]?.text("outcome") === "rescheduled" ? "rescheduled" : "stale";
    },

    async applyWorkflowReconciliation(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      validReasonCode(input.observedStatus, "observed workflow status");
      if (input.observedConclusion) {
        validReasonCode(input.observedConclusion, "observed workflow conclusion");
      }
      if (input.terminalStatus !== "failed" && input.terminalStatus !== "timed_out") {
        throw new Error("invalid workflow reconciliation terminal status");
      }
      validReasonCode(input.publicFailureReason, "public failure reason");
      const result = await executor.query(
        `select boardreadyops_apply_github_workflow_reconciliation(
           $1, $2, $3::timestamptz, $4, $5, $6, $7
         ) as outcome`,
        [
          input.reconciliationId,
          input.workerId,
          now().toISOString(),
          input.observedStatus,
          input.observedConclusion ?? null,
          input.terminalStatus,
          input.publicFailureReason,
        ],
      );
      const outcome = databaseRows(result)[0]?.text("outcome");
      if (outcome === "applied" || outcome === "already_terminal") return outcome;
      return "stale";
    },

    async applyCheckRunReconciliation(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      validReasonCode(input.observedStatus, "observed Check Run status");
      if (input.observedConclusion) validReasonCode(input.observedConclusion, "observed Check Run conclusion");
      if (input.action !== "observed_current" && input.action !== "updated") {
        throw new Error("invalid Check Run reconciliation action");
      }
      const result = await executor.query(
        `select boardreadyops_apply_github_check_run_reconciliation(
           $1, $2, $3::timestamptz, $4, $5, $6
         ) as outcome`,
        [
          input.reconciliationId,
          input.workerId,
          now().toISOString(),
          input.observedStatus,
          input.observedConclusion ?? null,
          input.action,
        ],
      );
      const outcome = databaseRows(result)[0]?.text("outcome");
      if (outcome === "applied" || outcome === "already_published") return outcome;
      return "stale";
    },

    async finalizeCheckRunReconciliationFailure(input) {
      validIdentifier(input.reconciliationId, "reconciliation id");
      validIdentifier(input.workerId, "reconciliation worker id");
      validReasonCode(input.observedStatus, "observed Check Run status");
      if (input.observedConclusion) validReasonCode(input.observedConclusion, "observed Check Run conclusion");
      validReasonCode(input.publicFailureReason, "public failure reason");
      const result = await executor.query(
        `select boardreadyops_fail_github_check_run_reconciliation(
           $1, $2, $3::timestamptz, $4, $5, $6
         ) as outcome`,
        [
          input.reconciliationId,
          input.workerId,
          now().toISOString(),
          input.observedStatus,
          input.observedConclusion ?? null,
          input.publicFailureReason,
        ],
      );
      const outcome = databaseRows(result)[0]?.text("outcome");
      if (outcome === "failed" || outcome === "already_published") return outcome;
      return "stale";
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
