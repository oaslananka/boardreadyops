import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * Evidence-only: neither the candidate nor the database acknowledgment grants
 * permission to dispatch, claim a runner lease or accept an OIDC callback.
 */
export type ProtectedReleaseIntentEvidence = {
  version: 2;
  kind: "protected-branch";
  /** Numeric GitHub installation ID, NOT installations.id. */
  installationId: number;
  /** Text internal repositories.id, not github_repo_id. */
  repositoryId: string;
  githubRepositoryId: number;
  githubOwnerId: number;
  actorGithubUserId: number;
  actorLogin: string;
  ref: string;
  sha: string;
  requestId: string;
  digest: string;
};

export type RecordedProtectedReleaseIntent = {
  id: string;
  inserted: boolean;
};

const sha = /^[0-9a-f]{40}$/u;
const digest = /^[0-9a-f]{64}$/u;
const requestKey = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

/**
 * Called only by a trusted server-side flow after GitHub session + repository
 * admin verification. The database function rechecks the authoritative mapping
 * under locks and enforces idempotency within one PostgreSQL transaction.
 */
export class ProtectedReleaseIntentStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async record(
    evidence: ProtectedReleaseIntentEvidence,
    context: {
      /** Trusted internal installations.id from the repository lookup. */
      internalInstallationId: string;
      /** Trusted numeric installations.github_installation_id. */
      githubInstallationId: number;
      observedAt: Date;
    },
  ): Promise<RecordedProtectedReleaseIntent> {
    if (
      evidence.version !== 2 ||
      evidence.kind !== "protected-branch" ||
      !context.internalInstallationId ||
      !Number.isSafeInteger(context.githubInstallationId) ||
      context.githubInstallationId <= 0 ||
      !Number.isSafeInteger(evidence.installationId) ||
      evidence.installationId !== context.githubInstallationId ||
      !Number.isSafeInteger(evidence.githubRepositoryId) ||
      evidence.githubRepositoryId <= 0 ||
      !Number.isSafeInteger(evidence.githubOwnerId) ||
      evidence.githubOwnerId <= 0 ||
      !Number.isSafeInteger(evidence.actorGithubUserId) ||
      evidence.actorGithubUserId <= 0 ||
      !evidence.repositoryId ||
      !sha.test(evidence.sha) ||
      !evidence.ref.startsWith("refs/heads/") ||
      !requestKey.test(evidence.requestId) ||
      !digest.test(evidence.digest) ||
      !Number.isFinite(context.observedAt.getTime())
    ) {
      throw new Error("Invalid protected-release evidence for durable recording.");
    }

    const statement = [
      "select candidate_id, inserted",
      "from boardreadyops_record_protected_release_intent_candidate_v2(",
      "$1, $2, $3::bigint, $4::bigint, $5::bigint, $6::bigint,",
      "$7, $8, $9, $10, $11, $12::timestamptz",
      ")",
    ].join(" ");
    const raw = (await this.db.query(statement, [
      context.internalInstallationId,
      evidence.repositoryId,
      context.githubInstallationId,
      evidence.githubRepositoryId,
      evidence.githubOwnerId,
      evidence.actorGithubUserId,
      evidence.actorLogin,
      evidence.ref,
      evidence.sha,
      evidence.requestId,
      evidence.digest,
      context.observedAt.toISOString(),
    ])) as { rows?: Array<Record<string, unknown>> };
    const row = raw.rows?.[0];
    if (!row || typeof row.candidate_id !== "string" || typeof row.inserted !== "boolean") {
      throw new Error("Protected-release evidence database acknowledgement unavailable.");
    }
    return { id: row.candidate_id, inserted: row.inserted };
  }
}
