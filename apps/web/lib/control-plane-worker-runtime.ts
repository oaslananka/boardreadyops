import type { GitHubAppLifecycleAction } from "@boardreadyops/cloud-core/lifecycle";
import type { ClaimedControlPlaneJob } from "@boardreadyops/db/control-plane-job-store";
import type { ClaimedControlPlaneOutboxEffect } from "@boardreadyops/db/control-plane-outbox-store";

export type WorkerScope = {
  installationId?: number | string;
  repositoryId?: number | string;
};

export type WorkerCorrelation = WorkerScope & {
  deliveryId?: string;
  repository?: string;
  releaseRunId?: string;
  executionAttemptId?: string;
  jobId?: string;
  outboxId?: string;
  effectType?: string;
};

type ScopedConcurrencySnapshot = {
  active: number;
  waiting: number;
};

export type ScopedConcurrencyGate = {
  run<T>(scope: WorkerScope, operation: () => Promise<T>): Promise<T>;
  snapshot(): ScopedConcurrencySnapshot;
};

type ActionContext = {
  installationId?: number | string;
  repositoryId?: number | string;
  repository?: string;
};

type PendingOperation = {
  scope: WorkerScope;
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

const sensitiveKeyFragments = [
  "authorization",
  "cookie",
  "credential",
  "findings",
  "oidc",
  "password",
  "privatekey",
  "repositorysource",
  "secret",
  "signedcapability",
  "sourcecontent",
  "token",
  "webhookpayload",
] as const;
const credentialAssignmentPattern =
  /\b(authorization|cookie|credential|password|private[_-]?key|secret|token)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const bearerPattern = /\bBearer\s+[a-z0-9._~+/=-]+/giu;
const maximumLogStringLength = 2_000;

function actionContext(action: GitHubAppLifecycleAction | undefined): ActionContext {
  if (!action) return {};
  const installationId = action.installation.id;
  if (!("repository" in action)) return { installationId };
  return {
    installationId,
    repositoryId: action.repository.id,
    repository: action.repository.fullName,
  };
}

function preferredJobAction(job: ClaimedControlPlaneJob): GitHubAppLifecycleAction | undefined {
  return job.actions.find((action) => "repository" in action) ?? job.actions[0];
}

function outboxAction(effect: ClaimedControlPlaneOutboxEffect): GitHubAppLifecycleAction | undefined {
  if (effect.payload.type === "github.check_run.create") return effect.payload.action;
  if (effect.payload.type === "github.workflow.dispatch") return effect.payload.input.action;
  return undefined;
}

function checkRunCompletionContext(effect: ClaimedControlPlaneOutboxEffect): ActionContext {
  if (effect.payload.type !== "github.check_run.complete") return {};
  const { installationId, repositoryOwner, repositoryName } = effect.payload.input;
  const repository = `${repositoryOwner}/${repositoryName}`;
  return {
    installationId,
    repositoryId: repository,
    repository,
  };
}

export function jobCorrelation(job: ClaimedControlPlaneJob): WorkerCorrelation {
  return {
    deliveryId: job.deliveryId,
    ...actionContext(preferredJobAction(job)),
    jobId: job.jobId,
  };
}

export function outboxCorrelation(effect: ClaimedControlPlaneOutboxEffect): WorkerCorrelation {
  const action = outboxAction(effect);
  const context = action ? actionContext(action) : checkRunCompletionContext(effect);
  return {
    ...context,
    ...(effect.releaseRunId ? { releaseRunId: effect.releaseRunId } : {}),
    ...(effect.executionAttemptId ? { executionAttemptId: effect.executionAttemptId } : {}),
    outboxId: effect.outboxId,
    effectType: effect.effectType,
  };
}

export function workerScopeFromJob(job: ClaimedControlPlaneJob): WorkerScope {
  const correlation = jobCorrelation(job);
  return {
    ...(correlation.installationId !== undefined ? { installationId: correlation.installationId } : {}),
    ...(correlation.repositoryId !== undefined ? { repositoryId: correlation.repositoryId } : {}),
  };
}

export function workerScopeFromOutboxEffect(effect: ClaimedControlPlaneOutboxEffect): WorkerScope {
  const correlation = outboxCorrelation(effect);
  return {
    ...(correlation.installationId !== undefined ? { installationId: correlation.installationId } : {}),
    ...(correlation.repositoryId !== undefined ? { repositoryId: correlation.repositoryId } : {}),
  };
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

function sanitizedString(value: string): string {
  return value
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(credentialAssignmentPattern, "$1=[REDACTED]")
    .slice(0, maximumLogStringLength);
}

function sanitizedValue(value: unknown, key: string | undefined, seen: WeakSet<object>): unknown {
  if (key && isSensitiveKey(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizedString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return undefined;
  if (typeof value === "symbol") return value.description ?? "Symbol";
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizedValue(item, undefined, seen));
  if (typeof value !== "object") return `[Unsupported ${typeof value}]`;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    result[nestedKey] = sanitizedValue(nestedValue, nestedKey, seen);
  }
  seen.delete(value);
  return result;
}

export function sanitizeWorkerLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizedValue(fields, undefined, new WeakSet<object>()) as Record<string, unknown>;
}

function scopeKey(value: number | string | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function count(map: Map<string, number>, key: string | undefined): number {
  return key === undefined ? 0 : (map.get(key) ?? 0);
}

function increment(map: Map<string, number>, key: string | undefined): void {
  if (key === undefined) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrement(map: Map<string, number>, key: string | undefined): void {
  if (key === undefined) return;
  const next = (map.get(key) ?? 1) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

export function createScopedConcurrencyGate(options: {
  installationLimit: number;
  repositoryLimit: number;
}): ScopedConcurrencyGate {
  if (!Number.isSafeInteger(options.installationLimit) || options.installationLimit <= 0) {
    throw new Error("installationLimit must be a positive integer");
  }
  if (!Number.isSafeInteger(options.repositoryLimit) || options.repositoryLimit <= 0) {
    throw new Error("repositoryLimit must be a positive integer");
  }

  const installationActive = new Map<string, number>();
  const repositoryActive = new Map<string, number>();
  const waiting: PendingOperation[] = [];
  let active = 0;
  let draining = false;

  function eligible(scope: WorkerScope): boolean {
    const installation = scopeKey(scope.installationId);
    const repository = scopeKey(scope.repositoryId);
    return (
      count(installationActive, installation) < options.installationLimit &&
      count(repositoryActive, repository) < options.repositoryLimit
    );
  }

  function reserve(scope: WorkerScope): void {
    active += 1;
    increment(installationActive, scopeKey(scope.installationId));
    increment(repositoryActive, scopeKey(scope.repositoryId));
  }

  function release(scope: WorkerScope): void {
    active -= 1;
    decrement(installationActive, scopeKey(scope.installationId));
    decrement(repositoryActive, scopeKey(scope.repositoryId));
  }

  function drain(): void {
    if (draining) return;
    draining = true;
    try {
      for (let index = 0; index < waiting.length; ) {
        const pending = waiting[index];
        if (!pending || !eligible(pending.scope)) {
          index += 1;
          continue;
        }
        waiting.splice(index, 1);
        reserve(pending.scope);
        void Promise.resolve()
          .then(pending.operation)
          .then(pending.resolve, pending.reject)
          .finally(() => {
            release(pending.scope);
            drain();
          });
      }
    } finally {
      draining = false;
    }
  }

  return {
    run<T>(scope: WorkerScope, operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          scope,
          operation,
          resolve: (value) => resolve(value as T),
          reject,
        });
        drain();
      });
    },
    snapshot(): ScopedConcurrencySnapshot {
      return { active, waiting: waiting.length };
    },
  };
}
