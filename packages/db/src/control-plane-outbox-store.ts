import type {
  CompleteGitHubCheckRunInput,
  DispatchReleaseRunWorkflowInput,
  EnqueueReleaseRunInput,
} from "@boardreadyops/cloud-core/lifecycle-executor";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type CheckRunCreateOutboxPayload = {
  version: 1;
  type: "github.check_run.create";
  action: EnqueueReleaseRunInput;
  runId: string;
  idempotencyKey: string;
};

export type CheckRunCompleteOutboxPayload = {
  version: 1;
  type: "github.check_run.complete";
  input: CompleteGitHubCheckRunInput;
};

export type WorkflowDispatchOutboxPayload = {
  version: 1;
  type: "github.workflow.dispatch";
  input: DispatchReleaseRunWorkflowInput;
};

export type ControlPlaneOutboxPayload =
  | CheckRunCreateOutboxPayload
  | CheckRunCompleteOutboxPayload
  | WorkflowDispatchOutboxPayload;

export type ControlPlaneOutboxEffectType = ControlPlaneOutboxPayload["type"];

export type ClaimedControlPlaneOutboxEffect = {
  outboxId: string;
  releaseRunId?: string;
  executionAttemptId?: string;
  effectType: ControlPlaneOutboxEffectType;
  payloadVersion: 1;
  idempotencyKey: string;
  payload: ControlPlaneOutboxPayload;
  attemptCount: number;
};

export type ControlPlaneOutboxMetrics = {
  availableEffects: number;
  leasedEffects: number;
  deadLetterEffects: number;
  reconciliationRequiredEffects: number;
  retryingEffects: number;
  oldestAvailableAgeSeconds: number;
  outboxLagSeconds: number;
};

export type CheckRunCreateTransitionResult = {
  outcome: "check_run_conflict" | "completed" | "stale";
  nextEffectType?: "github.check_run.complete" | "github.workflow.dispatch";
  nextOutboxId?: string;
  executionAttemptId?: string;
};

export type ControlPlaneOutboxStore = {
  claimEffects(input: { workerId: string; limit?: number }): Promise<ClaimedControlPlaneOutboxEffect[]>;
  markDeliveryStarted(input: { outboxId: string; workerId: string }): Promise<"started" | "stale">;
  completeCheckRunCreateEffect(input: {
    effect: ClaimedControlPlaneOutboxEffect;
    workerId: string;
    githubCheckRunId: number;
    dispatchMode: "github-actions" | "none";
    executionAttemptId?: string;
    nextOutboxId?: string;
  }): Promise<CheckRunCreateTransitionResult>;
  completeWorkflowDispatchEffect(input: {
    effect: ClaimedControlPlaneOutboxEffect;
    workerId: string;
    workflowDispatchId: string;
    workflowRunUrl?: string;
  }): Promise<"completed" | "stale">;
  completeEffect(input: {
    outboxId: string;
    workerId: string;
    externalResult?: Readonly<Record<string, unknown>>;
  }): Promise<"completed" | "stale">;
  failEffect(input: {
    outboxId: string;
    workerId: string;
    attemptCount: number;
    errorClass: string;
    errorMessage: string;
    deliveryUncertain?: boolean;
  }): Promise<"dead_letter" | "reconciliation_required" | "retry" | "stale">;
  replayEffect(input: { outboxId: string }): Promise<"not_replayable" | "replayed">;
  collectMetrics(): Promise<ControlPlaneOutboxMetrics>;
};

export type ControlPlaneOutboxStoreOptions = {
  now?: () => Date;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
};

const workerIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const supportedEffectTypes = new Set<ControlPlaneOutboxEffectType>([
  "github.check_run.create",
  "github.check_run.complete",
  "github.workflow.dispatch",
]);
const credentialAssignment = /\b(authorization|password|private[_-]?key|secret|token)\s*[=:]\s*[^\s,;]+/giu;

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

  json(column: string): unknown {
    return this.value?.[column];
  }
}

function databaseRows(result: unknown): DatabaseRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const values = (result as SqlQueryResult).rows;
  return Array.isArray(values) ? values.map((value) => new DatabaseRow(value)) : [];
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return selected;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodedPayload(row: DatabaseRow, effectType: ControlPlaneOutboxEffectType): ControlPlaneOutboxPayload {
  const payload = row.json("payload");
  if (!isJsonObject(payload) || payload.version !== 1 || payload.type !== effectType) {
    throw new Error("outbox effect payload did not match its row");
  }

  if (effectType === "github.check_run.create") {
    if (
      !isJsonObject(payload.action) ||
      typeof payload.runId !== "string" ||
      typeof payload.idempotencyKey !== "string"
    ) {
      throw new Error("outbox effect payload did not match its row");
    }
    return payload as unknown as CheckRunCreateOutboxPayload;
  }

  if (!isJsonObject(payload.input)) {
    throw new Error("outbox effect payload did not match its row");
  }
  return payload as unknown as CheckRunCompleteOutboxPayload | WorkflowDispatchOutboxPayload;
}

function decodedEffect(row: DatabaseRow): ClaimedControlPlaneOutboxEffect {
  const outboxId = row.text("outbox_id");
  const releaseRunId = row.text("release_run_id");
  const executionAttemptId = row.text("execution_attempt_id");
  const rawEffectType = row.text("effect_type");
  const payloadVersion = row.integer("payload_version");
  const idempotencyKey = row.text("idempotency_key");
  const attemptCount = row.integer("attempt_count");

  if (
    !outboxId ||
    !rawEffectType ||
    !supportedEffectTypes.has(rawEffectType as ControlPlaneOutboxEffectType) ||
    payloadVersion !== 1 ||
    !idempotencyKey ||
    attemptCount === undefined
  ) {
    throw new Error("control-plane outbox claim returned an incomplete effect");
  }

  const effectType = rawEffectType as ControlPlaneOutboxEffectType;
  return {
    outboxId,
    ...(releaseRunId ? { releaseRunId } : {}),
    ...(executionAttemptId ? { executionAttemptId } : {}),
    effectType,
    payloadVersion,
    idempotencyKey,
    payload: decodedPayload(row, effectType),
    attemptCount,
  };
}

function sanitizedFailure(value: string, maximum: number, fallback: string): string {
  const normalized = value
    .replace(credentialAssignment, "[redacted credential]")
    .replace(/[\r\n\t]+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximum);
}

function checkRunCreatePayload(effect: ClaimedControlPlaneOutboxEffect): CheckRunCreateOutboxPayload {
  if (effect.effectType !== "github.check_run.create" || effect.payload.type !== "github.check_run.create") {
    throw new Error("expected a Check Run creation outbox effect");
  }
  return effect.payload;
}

function workflowDispatchPayload(effect: ClaimedControlPlaneOutboxEffect): WorkflowDispatchOutboxPayload {
  if (effect.effectType !== "github.workflow.dispatch" || effect.payload.type !== "github.workflow.dispatch") {
    throw new Error("expected a workflow dispatch outbox effect");
  }
  return effect.payload;
}

function safeModeReason(action: EnqueueReleaseRunInput): string | undefined {
  if (action.pullRequestDraft) return "draft pull request";
  if (action.pullRequestFromFork) return "fork pull request safe mode";
  return undefined;
}

class SqlControlPlaneOutboxStore implements ControlPlaneOutboxStore {
  private readonly now: () => Date;
  private readonly leaseSeconds: number;
  private readonly retryBaseSeconds: number;

  constructor(
    private readonly executor: SqlQueryExecutor,
    options: ControlPlaneOutboxStoreOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseSeconds = positiveInteger(options.leaseSeconds, 120, "leaseSeconds");
    this.retryBaseSeconds = positiveInteger(options.retryBaseSeconds, 15, "retryBaseSeconds");
  }

  async claimEffects(input: { workerId: string; limit?: number }): Promise<ClaimedControlPlaneOutboxEffect[]> {
    if (!workerIdPattern.test(input.workerId)) throw new Error("invalid outbox worker id");
    const claimedAt = this.now();
    const leaseExpiresAt = new Date(claimedAt.valueOf() + this.leaseSeconds * 1000);
    const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
    const result = await this.executor.query(
      "select * from boardreadyops_claim_control_plane_outbox($1, $2::timestamptz, $3::timestamptz, $4::integer)",
      [input.workerId, claimedAt.toISOString(), leaseExpiresAt.toISOString(), limit],
    );
    return databaseRows(result).map(decodedEffect);
  }

  async markDeliveryStarted(input: { outboxId: string; workerId: string }): Promise<"started" | "stale"> {
    const result = await this.executor.query(
      "select boardreadyops_mark_control_plane_outbox_delivery_started($1, $2, $3::timestamptz) as outcome",
      [input.outboxId, input.workerId, this.now().toISOString()],
    );
    return databaseRows(result)[0]?.text("outcome") === "started" ? "started" : "stale";
  }

  async completeCheckRunCreateEffect(input: {
    effect: ClaimedControlPlaneOutboxEffect;
    workerId: string;
    githubCheckRunId: number;
    dispatchMode: "github-actions" | "none";
    executionAttemptId?: string;
    nextOutboxId?: string;
  }): Promise<CheckRunCreateTransitionResult> {
    const payload = checkRunCreatePayload(input.effect);
    const completedAt = this.now().toISOString();
    const skipReason = safeModeReason(payload.action);
    let nextEffectType: CheckRunCreateTransitionResult["nextEffectType"];
    let nextIdempotencyKey: string | undefined;
    let nextPayload: ControlPlaneOutboxPayload | undefined;

    if (skipReason) {
      if (!input.nextOutboxId) throw new Error("safe-mode completion requires a next outbox ID");
      nextEffectType = "github.check_run.complete";
      nextIdempotencyKey = `github.check_run.complete:${payload.runId}:skipped`;
      nextPayload = {
        version: 1,
        type: nextEffectType,
        input: {
          installationId: payload.action.installation.id,
          repositoryOwner: payload.action.repository.owner,
          repositoryName: payload.action.repository.name,
          checkRunId: input.githubCheckRunId,
          runId: payload.runId,
          conclusion: "neutral",
          title: "BoardReadyOps release readiness skipped",
          summary: `Runner dispatch was skipped by BoardReadyOps safe mode: ${skipReason}.`,
          completedAt,
        },
      };
    } else if (input.dispatchMode === "github-actions") {
      if (!input.executionAttemptId || !input.nextOutboxId) {
        throw new Error("workflow dispatch requires an execution attempt and next outbox ID");
      }
      nextEffectType = "github.workflow.dispatch";
      nextIdempotencyKey = `github.workflow.dispatch:${input.executionAttemptId}`;
      nextPayload = {
        version: 1,
        type: nextEffectType,
        input: {
          action: payload.action,
          runId: payload.runId,
          idempotencyKey: payload.idempotencyKey,
          githubCheckRunId: input.githubCheckRunId,
          executionAttemptId: input.executionAttemptId,
        },
      };
    }

    const result = await this.executor.query(
      `select * from boardreadyops_complete_check_run_create_effect(
         $1,
         $2,
         $3::timestamptz,
         $4::bigint,
         $5,
         $6,
         $7,
         $8::jsonb,
         $9
       )`,
      [
        input.effect.outboxId,
        input.workerId,
        completedAt,
        input.githubCheckRunId,
        input.nextOutboxId ?? null,
        nextEffectType ?? null,
        nextIdempotencyKey ?? null,
        nextPayload ? JSON.stringify(nextPayload) : null,
        input.executionAttemptId ?? null,
      ],
    );
    const row = databaseRows(result)[0];
    const outcome = row?.text("transition_outcome");
    const persistedNextEffectType = row?.text("next_effect_type");
    const persistedNextOutboxId = row?.text("next_outbox_id");
    const persistedExecutionAttemptId = row?.text("execution_attempt_id");

    return {
      outcome:
        outcome === "completed" || outcome === "check_run_conflict"
          ? outcome
          : "stale",
      ...(persistedNextEffectType === "github.check_run.complete" || persistedNextEffectType === "github.workflow.dispatch"
        ? { nextEffectType: persistedNextEffectType }
        : {}),
      ...(persistedNextOutboxId ? { nextOutboxId: persistedNextOutboxId } : {}),
      ...(persistedExecutionAttemptId ? { executionAttemptId: persistedExecutionAttemptId } : {}),
    };
  }

  async completeWorkflowDispatchEffect(input: {
    effect: ClaimedControlPlaneOutboxEffect;
    workerId: string;
    workflowDispatchId: string;
    workflowRunUrl?: string;
  }): Promise<"completed" | "stale"> {
    workflowDispatchPayload(input.effect);
    const result = await this.executor.query(
      `select boardreadyops_complete_workflow_dispatch_effect(
         $1, $2, $3::timestamptz, $4, $5
       ) as outcome`,
      [
        input.effect.outboxId,
        input.workerId,
        this.now().toISOString(),
        input.workflowDispatchId,
        input.workflowRunUrl ?? null,
      ],
    );
    return databaseRows(result)[0]?.text("outcome") === "completed" ? "completed" : "stale";
  }

  async completeEffect(input: {
    outboxId: string;
    workerId: string;
    externalResult?: Readonly<Record<string, unknown>>;
  }): Promise<"completed" | "stale"> {
    const result = await this.executor.query(
      `select boardreadyops_complete_control_plane_outbox(
         $1, $2, $3::timestamptz, $4::jsonb
       ) as outcome`,
      [
        input.outboxId,
        input.workerId,
        this.now().toISOString(),
        input.externalResult ? JSON.stringify(input.externalResult) : null,
      ],
    );
    return databaseRows(result)[0]?.text("outcome") === "completed" ? "completed" : "stale";
  }

  async failEffect(input: {
    outboxId: string;
    workerId: string;
    attemptCount: number;
    errorClass: string;
    errorMessage: string;
    deliveryUncertain?: boolean;
  }): Promise<"dead_letter" | "reconciliation_required" | "retry" | "stale"> {
    const failedAt = this.now();
    const attemptCount = positiveInteger(input.attemptCount, 1, "attemptCount");
    const retrySeconds = Math.min(3600, this.retryBaseSeconds * 2 ** Math.min(attemptCount - 1, 8));
    const retryAt = new Date(failedAt.valueOf() + retrySeconds * 1000);
    const result = await this.executor.query(
      `select boardreadyops_fail_control_plane_outbox(
         $1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7::boolean
       ) as outcome`,
      [
        input.outboxId,
        input.workerId,
        failedAt.toISOString(),
        retryAt.toISOString(),
        sanitizedFailure(input.errorClass, 100, "unclassified"),
        sanitizedFailure(input.errorMessage, 1000, "Control-plane outbox effect failed."),
        input.deliveryUncertain === true,
      ],
    );
    const outcome = databaseRows(result)[0]?.text("outcome");
    if (outcome === "retry" || outcome === "dead_letter" || outcome === "reconciliation_required") {
      return outcome;
    }
    return "stale";
  }

  async replayEffect(input: { outboxId: string }): Promise<"not_replayable" | "replayed"> {
    const result = await this.executor.query(
      "select boardreadyops_replay_control_plane_outbox($1, $2::timestamptz) as outcome",
      [input.outboxId, this.now().toISOString()],
    );
    return databaseRows(result)[0]?.text("outcome") === "replayed" ? "replayed" : "not_replayable";
  }

  async collectMetrics(): Promise<ControlPlaneOutboxMetrics> {
    const result = await this.executor.query(`
      select
        count(*) filter (where status = 'available')::bigint as available_effects,
        count(*) filter (where status = 'leased')::bigint as leased_effects,
        count(*) filter (where status = 'dead_letter')::bigint as dead_letter_effects,
        count(*) filter (where status = 'reconciliation_required')::bigint
          as reconciliation_required_effects,
        count(*) filter (where status = 'available' and attempt_count > 0)::bigint as retrying_effects,
        coalesce(
          greatest(
            0,
            floor(extract(epoch from (now() - (min(created_at) filter (where status = 'available')))))
          )::bigint,
          0
        ) as oldest_available_age_seconds,
        coalesce(
          greatest(
            0,
            floor(extract(epoch from (
              now() - (min(created_at) filter (where status in ('available', 'leased')))
            )))
          )::bigint,
          0
        ) as outbox_lag_seconds
      from control_plane_outbox
    `);
    const row = databaseRows(result)[0];
    return {
      availableEffects: row?.integer("available_effects") ?? 0,
      leasedEffects: row?.integer("leased_effects") ?? 0,
      deadLetterEffects: row?.integer("dead_letter_effects") ?? 0,
      reconciliationRequiredEffects: row?.integer("reconciliation_required_effects") ?? 0,
      retryingEffects: row?.integer("retrying_effects") ?? 0,
      oldestAvailableAgeSeconds: row?.integer("oldest_available_age_seconds") ?? 0,
      outboxLagSeconds: row?.integer("outbox_lag_seconds") ?? 0,
    };
  }
}

export function createSqlControlPlaneOutboxStore(
  executor: SqlQueryExecutor,
  options: ControlPlaneOutboxStoreOptions = {},
): ControlPlaneOutboxStore {
  return new SqlControlPlaneOutboxStore(executor, options);
}
