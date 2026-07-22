import { randomUUID } from "node:crypto";
import type {
  EnqueuedReleaseRunWithOutbox,
  GitHubAppDurableLifecycleStore,
} from "@boardreadyops/cloud-core/durable-lifecycle-planner";
import { releaseRunIdempotencyKey } from "@boardreadyops/cloud-core/lifecycle-executor";
import {
  createSqlGitHubAppLifecycleStore,
  releaseRepositoryRolloutPolicyFromEnvironment,
  type ReleaseRepositoryRolloutPolicy,
  type SqlLifecycleStoreOptions,
  type SqlQueryExecutor,
  type SqlQueryResult,
} from "./lifecycle-store.js";

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function text(row: Record<string, unknown> | undefined, column: string): string | undefined {
  const value = row?.[column];
  return typeof value === "string" ? value : undefined;
}

function normalizedRepository(fullName: string): string | undefined {
  const normalized = fullName.trim().toLowerCase();
  return normalized.includes("/") ? normalized : undefined;
}

function repositoryEnabled(fullName: string, policy: ReleaseRepositoryRolloutPolicy): boolean {
  if (policy.allowAllRepositories === true) return true;
  const normalized = normalizedRepository(fullName);
  return normalized ? new Set(policy.repositories ?? []).has(normalized) : false;
}

export function createSqlTransactionalGitHubAppLifecycleStore(
  executor: SqlQueryExecutor,
  options: SqlLifecycleStoreOptions = {},
): GitHubAppDurableLifecycleStore {
  const base = createSqlGitHubAppLifecycleStore(executor, options);
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const rollout =
    options.releaseRepositoryRolloutPolicy ?? releaseRepositoryRolloutPolicyFromEnvironment(process.env);

  return {
    upsertInstallation: base.upsertInstallation,
    deleteInstallation: base.deleteInstallation,
    upsertRepository: base.upsertRepository,
    removeRepository: base.removeRepository,

    async enqueueReleaseRunWithOutbox(action): Promise<EnqueuedReleaseRunWithOutbox> {
      const idempotencyKey = releaseRunIdempotencyKey(action);
      if (!repositoryEnabled(action.repository.fullName, rollout)) return { idempotencyKey };

      const runId = id();
      const outboxId = id();
      const outboxIdempotencyKey = `github.check_run.create:${runId}`;
      const payload = {
        version: 1 as const,
        type: "github.check_run.create" as const,
        action,
        runId,
        idempotencyKey,
      };
      const result = await executor.query(
        `select * from boardreadyops_enqueue_release_run_with_outbox(
           $1::bigint,
           $2::integer,
           $3,
           $4,
           $5,
           $6::bigint,
           $7::timestamptz,
           $8,
           $9,
           $10,
           $11,
           $12::jsonb
         )`,
        [
          action.repository.id,
          action.pullRequestNumber,
          action.commitSha,
          action.ref,
          action.triggerKind,
          action.installation.id,
          now().toISOString(),
          runId,
          idempotencyKey,
          outboxId,
          outboxIdempotencyKey,
          JSON.stringify(payload),
        ],
      );
      const row = rows(result)[0];
      const persistedRunId = text(row, "run_id");
      const status = text(row, "run_status");
      const persistedOutboxId = text(row, "outbox_id");

      return {
        idempotencyKey,
        ...(persistedRunId ? { runId: persistedRunId } : {}),
        ...(status ? { status } : {}),
        ...(persistedOutboxId ? { outboxId: persistedOutboxId } : {}),
      };
    },
  };
}
