import { randomUUID } from "node:crypto";
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

export type ControlPlaneOutboxFailure = {
  errorClass: string;
  errorMessage: string;
  deliveryUncertain?: boolean;
};

export type ControlPlaneOutboxStore = {
  claimEffects(input: { workerId: string; limit?: number }): Promise<ClaimedControlPlaneOutboxEffect[]>;
  markDeliveryStarted(input: {
    outboxId: string;
    workerId: string;
  }): Promise<"started" | "stale">;
  completeEffect(input: {
    outboxId: string;
    workerId: string;
    externalResult?: Readonly<Record<string, unknown>>;
  }): Promise<"completed" | "stale">;
  failEffect(
    input: { outboxId: string; workerId: string } & ControlPlaneOutboxFailure,
  ): Promise<"dead_letter" | "reconciliation_required" | "retry" | "stale">;
  replayEffect(input: { outboxId: string }): Promise<"not_replayable" | "replayed">;
  collectMetrics(): Promise<ControlPlaneOutboxMetrics>;
};

export type ControlPlaneOutboxStoreOptions = {
  now?: () => Date;
  id?: () => string;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const credentialPattern = /\b(authorization|password|private[_-]?key|secret|token)\s*[=:]\s*[^\s,;]+/giu;
const effectTypes = new Set<ControlPlaneOutboxEffectType>([
  "github.check_run.create",
  "github.check_run.complete",
  "github.workflow.dispatch",
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

function numberColumn(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return selected;
}

function boundedError(value: string, maximum: number, fallback: string): string {
  const normalized = value
    .replace(credentialPattern, "[redacted credential]")
    .replace(/[\r\n\t]+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximum);
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadColumn(
  row: Record<string, unknown>,
  effectType: ControlPlaneOutboxEffectType,
): ControlPlaneOutboxPayload {
  const value = row.payload;
  if (!jsonObject(value) || value.version !== 1 || value.type !== effectType) {
    throw new Error("outbox effect payload did not match its row");
  }

  if (effectType === "github.check_run.create") {
    if (!jsonObject(value.action) || typeof value.runId !== "string" || typeof value.idempotencyKey !== "string") {
      throw new Error("outbox effect payload did not match its row");
    }
    return value as unknown as CheckRunCreateOutboxPayload;
  }

  if (!jsonObject(value.input)) {
    throw new Error("outbox effect payload did not match its row");
  }

  return value as unknown as CheckRunCompleteOutboxPayload | WorkflowDispatchOutboxPayload;
}

function decodedEffect(row: Record<string, unknown>): ClaimedControlPlaneOutboxEffect {
  const outboxId = stringColumn(row, "outbox_id");
  const releaseRunId = stringColumn(row, "release_run_id");
  const executionAttemptId = stringColumn(row, "execution_attempt_id");
  const effectTypeValue = stringColumn(row, "effect_type");
  const payloadVersion = numberColumn(row, "payload_version");
  const idempotencyKey = stringColumn(row, "idempotency_key");
  const attemptCount = numberColumn(row, "attempt_count");

  if (
    !outboxId ||
    !effectTypeValue ||
    !effectTypes.has(effectTypeValue as ControlPlaneOutboxEffectType) ||
    payloadVersion !== 1 ||
    !idempotencyKey ||
    attemptCount === undefined
  ) {
    throw new Error("control-plane outbox claim returned an incomplete effect");
  }

  const effectType = effectTypeValue as ControlPlaneOutboxEffectType;
  return {
    outboxId,
    ...(releaseRunId ? { releaseRunId } : {}),
    ...(executionAttemptId ? { executionAttemptId } : {}),
    effectType,
    payloadVersion,
    idempotencyKey,
    payload: payloadColumn(row, effectType),
    attemptCount,
  };
}

export function createSqlControlPlaneOutboxStore(
  executor: SqlQueryExecutor,
  options: ControlPlaneOutboxStoreOptions = {},
): ControlPlaneOutboxStore {
  const now = options.now ?? (() => new Date());
  const leaseSeconds = positiveInteger(options.leaseSeconds, 120, "leaseSeconds");
  const retryBaseSeconds = positiveInteger(options.retryBaseSeconds, 15, "retryBaseSeconds");

  return {
    async claimEffects(input) {
      if (!identifierPattern.test(input.workerId)) throw new Error("invalid outbox worker id");
      const at = now();
      const leaseExpiresAt = new Date(at.valueOf() + leaseSeconds * 1000);
      const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
      const result = await executor.query(
        "select * from boardreadyops_claim_control_plane_outbox($1, $2::timestamptz, $3::timestamptz, $4::integer)",
        [input.workerId, at.toISOString(), leaseExpiresAt.toISOString(), limit],
      );
      return rows(result).map(decodedEffect);
    },

    async markDeliveryStarted(input) {
      const result = await executor.query(
        "select boardreadyops_mark_control_plane_outbox_delivery_started($1, $2, $3::timestamptz) as outcome",
        [input.outboxId, input.workerId, now().toISOString()],
      );
      return stringColumn(rows(result)[0], "outcome") === "started" ? "started" : "stale";
    },

    async completeEffect(input) {
      const result = await executor.query(
        `select boardreadyops_complete_control_plane_outbox(
           $1, $2, $3::timestamptz, $4::jsonb
         ) as outcome`,
        [
          input.outboxId,
          input.workerId,
          now().toISOString(),
          input.externalResult ? JSON.stringify(input.externalResult) : null,
        ],
      );
      return stringColumn(rows(result)[0], "outcome") === "completed" ? "completed" : "stale";
    },

    async failEffect(input) {
      const at = now();
      const attemptResult = await executor.query(
        "select attempt_count from control_plane_outbox where id = $1",
        [input.outboxId],
      );
      const attemptCount = Math.max(1, numberColumn(rows(attemptResult)[0], "attempt_count") ?? 1);
      const delaySeconds = Math.min(3600, retryBaseSeconds * 2 ** Math.min(attemptCount - 1, 8));
      const retryAt = new Date(at.valueOf() + delaySeconds * 1000);
      const result = await executor.query(
        `select boardreadyops_fail_control_plane_outbox(
           $1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7::boolean
         ) as outcome`,
        [
          input.outboxId,
          input.workerId,
          at.toISOString(),
          retryAt.toISOString(),
          boundedError(input.errorClass, 100, "unclassified"),
          boundedError(input.errorMessage, 1000, "Control-plane outbox effect failed."),
          input.deliveryUncertain === true,
        ],
      );
      const outcome = stringColumn(rows(result)[0], "outcome");
      return outcome === "retry" || outcome === "dead_letter" || outcome === "reconciliation_required"
        ? outcome
        : "stale";
    },

    async replayEffect(input) {
      const result = await executor.query(
        "select boardreadyops_replay_control_plane_outbox($1, $2::timestamptz) as outcome",
        [input.outboxId, now().toISOString()],
      );
      return stringColumn(rows(result)[0], "outcome") === "replayed" ? "replayed" : "not_replayable";
    },

    async collectMetrics() {
      const result = await executor.query(`
        select
          count(*) filter (where status = 'available')::bigint as available_effects,
          count(*) filter (where status = 'leased')::bigint as leased_effects,
          count(*) filter (where status = 'dead_letter')::bigint as dead_letter_effects,
          count(*) filter (where status = 'reconciliation_required')::bigint
            as reconciliation_required_effects,
          count(*) filter (where status = 'available' and attempt_count > 0)::bigint as retrying_effects,
          coalesce(
            greatest(0, floor(extract(epoch from (now() - min(created_at))) filter (where status = 'available')))::bigint,
            0
          ) as oldest_available_age_seconds,
          coalesce(
            greatest(0, floor(extract(epoch from (now() - min(created_at))) filter (
              where status in ('available', 'leased')
            )))::bigint,
            0
          ) as outbox_lag_seconds
        from control_plane_outbox
      `);
      const row = rows(result)[0];
      return {
        availableEffects: numberColumn(row, "available_effects") ?? 0,
        leasedEffects: numberColumn(row, "leased_effects") ?? 0,
        deadLetterEffects: numberColumn(row, "dead_letter_effects") ?? 0,
        reconciliationRequiredEffects: numberColumn(row, "reconciliation_required_effects") ?? 0,
        retryingEffects: numberColumn(row, "retrying_effects") ?? 0,
        oldestAvailableAgeSeconds: numberColumn(row, "oldest_available_age_seconds") ?? 0,
        outboxLagSeconds: numberColumn(row, "outbox_lag_seconds") ?? 0,
      };
    },
  };
}

type MemoryEffect = ClaimedControlPlaneOutboxEffect & {
  status: "available" | "completed" | "dead_letter" | "leased" | "reconciliation_required";
  workerId?: string;
};

export function createMemoryControlPlaneOutboxStore(
  options: ControlPlaneOutboxStoreOptions = {},
): ControlPlaneOutboxStore & { enqueue(payload: ControlPlaneOutboxPayload): string } {
  const id = options.id ?? randomUUID;
  const effects = new Map<string, MemoryEffect>();

  return {
    enqueue(payload) {
      const outboxId = id();
      effects.set(outboxId, {
        outboxId,
        effectType: payload.type,
        payloadVersion: 1,
        idempotencyKey: `${payload.type}:${outboxId}`,
        payload,
        attemptCount: 0,
        status: "available",
      });
      return outboxId;
    },
    async claimEffects(input) {
      const selected = [...effects.values()]
        .filter((effect) => effect.status === "available")
        .slice(0, Math.max(1, Math.min(input.limit ?? 1, 100)));
      for (const effect of selected) {
        effect.status = "leased";
        effect.workerId = input.workerId;
        effect.attemptCount += 1;
      }
      return selected.map(({ status: _status, workerId: _workerId, ...effect }) => effect);
    },
    async markDeliveryStarted(input) {
      const effect = effects.get(input.outboxId);
      return effect?.status === "leased" && effect.workerId === input.workerId ? "started" : "stale";
    },
    async completeEffect(input) {
      const effect = effects.get(input.outboxId);
      if (effect?.status !== "leased" || effect.workerId !== input.workerId) return "stale";
      effect.status = "completed";
      effect.workerId = undefined;
      return "completed";
    },
    async failEffect(input) {
      const effect = effects.get(input.outboxId);
      if (effect?.status !== "leased" || effect.workerId !== input.workerId) return "stale";
      effect.status = input.deliveryUncertain && effect.effectType === "github.workflow.dispatch"
        ? "reconciliation_required"
        : "available";
      effect.workerId = undefined;
      return effect.status === "available" ? "retry" : "reconciliation_required";
    },
    async replayEffect(input) {
      const effect = effects.get(input.outboxId);
      if (effect?.status !== "dead_letter") return "not_replayable";
      effect.status = "available";
      effect.attemptCount = 0;
      return "replayed";
    },
    async collectMetrics() {
      const values = [...effects.values()];
      return {
        availableEffects: values.filter((effect) => effect.status === "available").length,
        leasedEffects: values.filter((effect) => effect.status === "leased").length,
        deadLetterEffects: values.filter((effect) => effect.status === "dead_letter").length,
        reconciliationRequiredEffects: values.filter((effect) => effect.status === "reconciliation_required").length,
        retryingEffects: values.filter((effect) => effect.status === "available" && effect.attemptCount > 0).length,
        oldestAvailableAgeSeconds: 0,
        outboxLagSeconds: 0,
      };
    },
  };
}
