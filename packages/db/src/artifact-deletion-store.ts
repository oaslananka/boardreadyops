import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type ClaimedArtifactDeletion = {
  deletionJobId: string;
  artifactId: string;
  installationId: string;
  repositoryId: string;
  releaseRunId: string;
  storageDriver: string;
  storagePath: string;
  deletionReason: string;
  attemptCount: number;
};

export type ArtifactDeletionMetrics = {
  availableArtifactDeletions: number;
  leasedArtifactDeletions: number;
  deadLetterArtifactDeletions: number;
  oldestAvailableArtifactDeletionAgeSeconds: number;
};

export type ArtifactDeletionStore = {
  claimDeletions(input: { workerId: string; limit?: number }): Promise<ClaimedArtifactDeletion[]>;
  completeDeletion(input: {
    deletionJobId: string;
    workerId: string;
    outcome: "deleted" | "missing";
  }): Promise<"completed" | "stale">;
  failDeletion(input: {
    deletionJobId: string;
    workerId: string;
    attemptCount: number;
    retryable: boolean;
    errorClass: string;
    errorMessage: string;
  }): Promise<"dead_letter" | "retry" | "stale">;
  collectMetrics(): Promise<ArtifactDeletionMetrics>;
};

export type ArtifactDeletionStoreOptions = {
  now?: () => Date;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
};

const workerIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const credentialAssignment = /\b(authorization|password|private[_-]?key|secret|token)\s*[=:]\s*[^\s,;]+/giu;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function text(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function integer(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${label} must be a positive integer`);
  return selected;
}

function safeFailure(value: string, maximum: number, fallback: string): string {
  const normalized = value
    .replace(credentialAssignment, "[redacted credential]")
    .replace(/[\r\n\t]+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximum);
}

function claimedDeletion(row: Record<string, unknown>): ClaimedArtifactDeletion {
  const deletionJobId = text(row, "deletion_job_id");
  const artifactId = text(row, "artifact_id");
  const installationId = text(row, "installation_id");
  const repositoryId = text(row, "repository_id");
  const releaseRunId = text(row, "release_run_id");
  const storageDriver = text(row, "storage_driver");
  const storagePath = text(row, "storage_path");
  const deletionReason = text(row, "deletion_reason");
  const attemptCount = integer(row, "attempt_count");
  if (
    !deletionJobId ||
    !artifactId ||
    !installationId ||
    !repositoryId ||
    !releaseRunId ||
    !storageDriver ||
    !storagePath ||
    !deletionReason ||
    attemptCount === undefined
  ) {
    throw new Error("artifact deletion claim returned an incomplete job");
  }
  return {
    deletionJobId,
    artifactId,
    installationId,
    repositoryId,
    releaseRunId,
    storageDriver,
    storagePath,
    deletionReason,
    attemptCount,
  };
}

export function createSqlArtifactDeletionStore(
  executor: SqlQueryExecutor,
  options: ArtifactDeletionStoreOptions = {},
): ArtifactDeletionStore {
  const now = options.now ?? (() => new Date());
  const leaseSeconds = positiveInteger(options.leaseSeconds, 120, "leaseSeconds");
  const retryBaseSeconds = positiveInteger(options.retryBaseSeconds, 15, "retryBaseSeconds");

  return {
    async claimDeletions(input) {
      if (!workerIdPattern.test(input.workerId)) throw new Error("invalid artifact deletion worker id");
      const claimedAt = now();
      const leaseExpiresAt = new Date(claimedAt.valueOf() + leaseSeconds * 1000);
      const limit = Math.max(1, Math.min(input.limit ?? 1, 100));
      const result = await executor.query(
        "select * from boardreadyops_claim_artifact_deletions($1, $2::timestamptz, $3::timestamptz, $4::integer)",
        [input.workerId, claimedAt.toISOString(), leaseExpiresAt.toISOString(), limit],
      );
      return rows(result).map(claimedDeletion);
    },

    async completeDeletion(input) {
      const result = await executor.query(
        "select boardreadyops_complete_artifact_deletion($1, $2, $3::timestamptz, $4) as outcome",
        [input.deletionJobId, input.workerId, now().toISOString(), input.outcome],
      );
      return text(rows(result)[0], "outcome") === "completed" ? "completed" : "stale";
    },

    async failDeletion(input) {
      const failedAt = now();
      const attemptCount = positiveInteger(input.attemptCount, 1, "attemptCount");
      const retrySeconds = Math.min(3600, retryBaseSeconds * 2 ** Math.min(attemptCount - 1, 8));
      const retryAt = new Date(failedAt.valueOf() + retrySeconds * 1000);
      const result = await executor.query(
        `select boardreadyops_fail_artifact_deletion(
           $1, $2, $3::timestamptz, $4::timestamptz, $5::boolean, $6, $7
         ) as outcome`,
        [
          input.deletionJobId,
          input.workerId,
          failedAt.toISOString(),
          retryAt.toISOString(),
          input.retryable,
          safeFailure(input.errorClass, 100, "unclassified"),
          safeFailure(input.errorMessage, 1000, "Artifact object deletion failed."),
        ],
      );
      const outcome = text(rows(result)[0], "outcome");
      return outcome === "retry" || outcome === "dead_letter" ? outcome : "stale";
    },

    async collectMetrics() {
      const result = await executor.query(
        `select count(*) filter (where status = 'available')::integer as available,
                count(*) filter (where status = 'leased')::integer as leased,
                count(*) filter (where status = 'dead_letter')::integer as dead_letter,
                coalesce(extract(epoch from (now() - min(created_at) filter (where status = 'available'))), 0)::integer as oldest_age
         from artifact_deletion_jobs`,
      );
      const row = rows(result)[0];
      return {
        availableArtifactDeletions: integer(row, "available") ?? 0,
        leasedArtifactDeletions: integer(row, "leased") ?? 0,
        deadLetterArtifactDeletions: integer(row, "dead_letter") ?? 0,
        oldestAvailableArtifactDeletionAgeSeconds: integer(row, "oldest_age") ?? 0,
      };
    },
  };
}
