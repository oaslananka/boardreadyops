import { randomUUID } from "node:crypto";
import type { GitHubAppLifecycleAction } from "@boardreadyops/cloud-core/lifecycle";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type AcceptGitHubWebhookInput = {
  deliveryId: string;
  eventType: string;
  eventAction?: string;
  installationExternalId?: number;
  repositoryExternalId?: number;
  repositoryFullName?: string;
  payloadSha256: string;
  actions: readonly GitHubAppLifecycleAction[];
  receivedAt?: Date;
};

export type AcceptGitHubWebhookResult = {
  outcome: "accepted" | "duplicate";
  inboxId: string;
  jobId?: string;
  queued: boolean;
};

export type ClaimedControlPlaneJob = {
  jobId: string;
  inboxId: string;
  jobType: "github_webhook.lifecycle";
  payloadVersion: 1;
  attemptCount: number;
  eventType: string;
  eventAction?: string;
  deliveryId: string;
  actions: GitHubAppLifecycleAction[];
};

export type ControlPlaneJobFailure = {
  errorClass: string;
  errorMessage: string;
};

export type ControlPlaneJobMetrics = {
  availableJobs: number;
  leasedJobs: number;
  deadLetterJobs: number;
  duplicateDeliveries: number;
  oldestUnprocessedAgeSeconds: number;
};

export type ControlPlaneJobStore = {
  acceptGitHubWebhook(input: AcceptGitHubWebhookInput): Promise<AcceptGitHubWebhookResult>;
  claimJobs(input: { workerId: string; limit?: number }): Promise<ClaimedControlPlaneJob[]>;
  completeJob(input: { jobId: string; workerId: string }): Promise<"completed" | "stale">;
  failJob(
    input: { jobId: string; workerId: string } & ControlPlaneJobFailure,
  ): Promise<"dead_letter" | "retry" | "stale">;
  collectMetrics(): Promise<ControlPlaneJobMetrics>;
  purgeExpired(input?: { limit?: number }): Promise<number>;
};

export type ControlPlaneJobStoreOptions = {
  now?: () => Date;
  id?: () => string;
  retentionDays?: number;
  leaseSeconds?: number;
  maximumAttempts?: number;
  retryBaseSeconds?: number;
};

const sha256Pattern = /^[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

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
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${name} must be a positive integer`);
  return selected;
}

function validAcceptance(input: AcceptGitHubWebhookInput): boolean {
  return (
    identifierPattern.test(input.deliveryId) &&
    identifierPattern.test(input.eventType) &&
    sha256Pattern.test(input.payloadSha256) &&
    input.actions.length > 0 &&
    input.actions.length <= 100
  );
}

function actionsColumn(row: Record<string, unknown> | undefined): GitHubAppLifecycleAction[] {
  const value = row?.normalized_actions;
  if (!Array.isArray(value)) throw new Error("control-plane job did not contain normalized actions");
  return value as GitHubAppLifecycleAction[];
}

function boundedError(value: string, maximum: number, fallback: string): string {
  const normalized = value.trim();
  return (normalized || fallback).slice(0, maximum);
}

export function createSqlControlPlaneJobStore(
  executor: SqlQueryExecutor,
  options: ControlPlaneJobStoreOptions = {},
): ControlPlaneJobStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const retentionDays = positiveInteger(options.retentionDays, 30, "retentionDays");
  const leaseSeconds = positiveInteger(options.leaseSeconds, 120, "leaseSeconds");
  const maximumAttempts = positiveInteger(options.maximumAttempts, 8, "maximumAttempts");
  const retryBaseSeconds = positiveInteger(options.retryBaseSeconds, 15, "retryBaseSeconds");

  return {
    async acceptGitHubWebhook(input) {
      if (!validAcceptance(input)) throw new Error("invalid durable GitHub webhook intake");
      const receivedAt = input.receivedAt ?? now();
      const retentionUntil = new Date(receivedAt.valueOf() + retentionDays * 86_400_000);
      const inboxId = id();
      const jobId = id();
      const result = await executor.query(
        `select * from boardreadyops_accept_github_webhook(
           $1, $2, 'github', $3, $4, $5, $6::bigint, $7::bigint, $8,
           $9, $10::jsonb, $11::timestamptz, $12::timestamptz, $13::integer
         )`,
        [
          inboxId,
          jobId,
          input.deliveryId,
          input.eventType,
          input.eventAction ?? null,
          input.installationExternalId ?? null,
          input.repositoryExternalId ?? null,
          input.repositoryFullName ?? null,
          input.payloadSha256,
          JSON.stringify(input.actions),
          receivedAt.toISOString(),
          retentionUntil.toISOString(),
          maximumAttempts,
        ],
      );
      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      const returnedInboxId = stringColumn(row, "inbox_id");
      const returnedJobId = stringColumn(row, "job_id");
      if ((outcome !== "accepted" && outcome !== "duplicate") || !returnedInboxId) {
        throw new Error("durable GitHub webhook intake returned an invalid result");
      }
      return {
        outcome,
        inboxId: returnedInboxId,
        ...(returnedJobId ? { jobId: returnedJobId } : {}),
        queued: outcome === "accepted",
      };
    },

    async claimJobs(input) {
      if (!identifierPattern.test(input.workerId)) throw new Error("invalid control-plane worker id");
      const at = now();
      const leaseExpiresAt = new Date(at.valueOf() + leaseSeconds * 1000);
      const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
      const result = await executor.query(
        "select * from boardreadyops_claim_control_plane_jobs($1, $2::timestamptz, $3::timestamptz, $4::integer)",
        [input.workerId, at.toISOString(), leaseExpiresAt.toISOString(), limit],
      );
      return rows(result).map((row) => {
        const jobId = stringColumn(row, "job_id");
        const inboxId = stringColumn(row, "inbox_id");
        const jobType = stringColumn(row, "job_type");
        const payloadVersion = numberColumn(row, "payload_version");
        const attemptCount = numberColumn(row, "attempt_count");
        const eventType = stringColumn(row, "event_type");
        const eventAction = stringColumn(row, "event_action");
        const deliveryId = stringColumn(row, "delivery_id");
        if (
          !jobId ||
          !inboxId ||
          jobType !== "github_webhook.lifecycle" ||
          payloadVersion !== 1 ||
          attemptCount === undefined ||
          !eventType ||
          !deliveryId
        ) {
          throw new Error("control-plane claim returned an incomplete job");
        }
        return {
          jobId,
          inboxId,
          jobType,
          payloadVersion,
          attemptCount,
          eventType,
          ...(eventAction ? { eventAction } : {}),
          deliveryId,
          actions: actionsColumn(row),
        };
      });
    },

    async collectMetrics() {
      const result = await executor.query(`
        select
          count(*) filter (where cpj.status = 'available')::bigint as available_jobs,
          count(*) filter (where cpj.status = 'leased')::bigint as leased_jobs,
          count(*) filter (where cpj.status = 'dead_letter')::bigint as dead_letter_jobs,
          coalesce((select sum(wi.duplicate_count)::bigint from webhook_inbox wi), 0)::bigint
            as duplicate_deliveries,
          coalesce(
            greatest(0, floor(extract(epoch from (now() - min(wi.received_at)))))::bigint,
            0
          ) as oldest_unprocessed_age_seconds
        from control_plane_jobs cpj
        left join webhook_inbox wi
          on wi.id = cpj.inbox_id
         and cpj.status in ('available', 'leased')
      `);
      const row = rows(result)[0];
      return {
        availableJobs: numberColumn(row, "available_jobs") ?? 0,
        leasedJobs: numberColumn(row, "leased_jobs") ?? 0,
        deadLetterJobs: numberColumn(row, "dead_letter_jobs") ?? 0,
        duplicateDeliveries: numberColumn(row, "duplicate_deliveries") ?? 0,
        oldestUnprocessedAgeSeconds: numberColumn(row, "oldest_unprocessed_age_seconds") ?? 0,
      };
    },

    async purgeExpired(input = {}) {
      const limit = Math.max(1, Math.min(input.limit ?? 1000, 10_000));
      const result = await executor.query(
        "select boardreadyops_purge_expired_webhook_inbox($1::timestamptz, $2::integer) as purged",
        [now().toISOString(), limit],
      );
      return numberColumn(rows(result)[0], "purged") ?? 0;
    },

    async completeJob(input) {
      const result = await executor.query(
        "select boardreadyops_complete_control_plane_job($1, $2, $3::timestamptz) as outcome",
        [input.jobId, input.workerId, now().toISOString()],
      );
      return stringColumn(rows(result)[0], "outcome") === "completed" ? "completed" : "stale";
    },

    async failJob(input) {
      const at = now();
      const attemptResult = await executor.query("select attempt_count from control_plane_jobs where id = $1", [
        input.jobId,
      ]);
      const attemptCount = Math.max(1, numberColumn(rows(attemptResult)[0], "attempt_count") ?? 1);
      const delaySeconds = Math.min(3600, retryBaseSeconds * 2 ** Math.min(attemptCount - 1, 8));
      const retryAt = new Date(at.valueOf() + delaySeconds * 1000);
      const result = await executor.query(
        `select boardreadyops_fail_control_plane_job(
           $1, $2, $3::timestamptz, $4::timestamptz, $5, $6
         ) as outcome`,
        [
          input.jobId,
          input.workerId,
          at.toISOString(),
          retryAt.toISOString(),
          boundedError(input.errorClass, 100, "unclassified"),
          boundedError(input.errorMessage, 1000, "Control-plane job failed."),
        ],
      );
      const outcome = stringColumn(rows(result)[0], "outcome");
      return outcome === "retry" || outcome === "dead_letter" ? outcome : "stale";
    },
  };
}

type MemoryInbox = { digest: string; inboxId: string; jobId: string };

export function createMemoryControlPlaneJobStore(options: ControlPlaneJobStoreOptions = {}): ControlPlaneJobStore {
  const id = options.id ?? randomUUID;
  const inbox = new Map<string, MemoryInbox>();
  let duplicateDeliveries = 0;

  return {
    async acceptGitHubWebhook(input) {
      if (!validAcceptance(input)) throw new Error("invalid durable GitHub webhook intake");
      const key = `github:${input.deliveryId}`;
      const existing = inbox.get(key);
      if (existing) {
        duplicateDeliveries += 1;
        return { outcome: "duplicate", inboxId: existing.inboxId, jobId: existing.jobId, queued: false };
      }
      const accepted = { digest: input.payloadSha256, inboxId: id(), jobId: id() };
      inbox.set(key, accepted);
      return { outcome: "accepted", inboxId: accepted.inboxId, jobId: accepted.jobId, queued: true };
    },
    async claimJobs() {
      return [];
    },
    async collectMetrics() {
      return {
        availableJobs: inbox.size,
        leasedJobs: 0,
        deadLetterJobs: 0,
        duplicateDeliveries,
        oldestUnprocessedAgeSeconds: 0,
      };
    },
    async purgeExpired() {
      return 0;
    },
    async completeJob() {
      return "stale";
    },
    async failJob() {
      return "stale";
    },
  };
}
