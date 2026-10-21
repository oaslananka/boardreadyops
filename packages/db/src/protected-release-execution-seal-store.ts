import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * A sealed proposal, not an execution permit. This code never enqueues,
 * dispatches, signs, issues a lease, or grants OIDC callback privileges.
 */
export type ProtectedReleaseExecutionSealRequest = {
  candidateId: string;
  internalInstallationId: string;
  internalRepositoryId: string;
  githubInstallationId: number;
  githubRepositoryId: number;
  actorGithubUserId: number;
  reservedRunId: string;
  reservedAttemptId: string;
};

export type ProtectedReleaseExecutionSeal = {
  id: string;
  digest: string;
  inserted: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digest = /^[0-9a-f]{64}$/u;

export class ProtectedReleaseExecutionSealStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async seal(input: ProtectedReleaseExecutionSealRequest, observedAt: Date): Promise<ProtectedReleaseExecutionSeal> {
    if (
      !uuid.test(input.candidateId) ||
      !uuid.test(input.internalInstallationId) ||
      !uuid.test(input.internalRepositoryId) ||
      !Number.isSafeInteger(input.githubInstallationId) ||
      input.githubInstallationId <= 0 ||
      !Number.isSafeInteger(input.githubRepositoryId) ||
      input.githubRepositoryId <= 0 ||
      !Number.isSafeInteger(input.actorGithubUserId) ||
      input.actorGithubUserId <= 0 ||
      !uuid.test(input.reservedRunId) ||
      !uuid.test(input.reservedAttemptId) ||
      input.reservedRunId === input.reservedAttemptId ||
      !(observedAt instanceof Date) ||
      !Number.isFinite(observedAt.getTime())
    ) {
      throw new Error("Invalid non-executable protected release seal identity.");
    }

    const statement = [
      "select seal_id, seal_digest, inserted",
      "from boardreadyops_seal_protected_release_identity(",
      "$1, $2, $3, $4::bigint, $5::bigint, $6::bigint, $7, $8, $9::timestamptz)",
    ].join(" ");
    const result = (await this.executor.query(statement, [
      input.candidateId,
      input.internalInstallationId,
      input.internalRepositoryId,
      input.githubInstallationId,
      input.githubRepositoryId,
      input.actorGithubUserId,
      input.reservedRunId,
      input.reservedAttemptId,
      observedAt.toISOString(),
    ])) as { rows?: readonly Record<string, unknown>[] };
    const row = result.rows?.[0];
    if (
      !row ||
      typeof row.seal_id !== "string" ||
      !uuid.test(row.seal_id) ||
      typeof row.seal_digest !== "string" ||
      !digest.test(row.seal_digest) ||
      typeof row.inserted !== "boolean"
    ) {
      throw new Error("Protected release execution seal database acknowledgement unavailable.");
    }
    return { id: row.seal_id, digest: row.seal_digest, inserted: row.inserted };
  }
}
