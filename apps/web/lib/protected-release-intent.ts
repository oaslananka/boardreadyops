import { createHash } from "node:crypto";
import {
  inspectProtectedBranchHead,
  inspectProtectedReleaseOperator,
  type ProtectedBranchHeadInput,
} from "./github-protected-branch-evidence.js";

/**
 * Preflight evidence candidate, NOT a release authority or dispatch credential.
 * All identity and repository inputs must originate in authenticated, trusted
 * server state. A durable transaction must independently bind and revalidate
 * this evidence before granting any runner privileges.
 */
export type ProtectedReleaseIntentCandidate = {
  version: 2;
  kind: "protected-branch";
  installationId: number;
  repositoryId: string;
  githubRepositoryId: number;
  githubOwnerId: number;
  actorGithubUserId: number;
  actorLogin: string;
  ref: string;
  sha: string;
  requestId: string;
  /** Correlation-only digest; NOT a digital signature or replay protection. */
  digest: string;
};

type Request = NonNullable<ProtectedBranchHeadInput["request"]>;

export type ProtectedReleaseRequestInput = {
  actor: {
    /** A confirmed GitHub session, not a self-asserted value or API bearer token. */
    authType: "session" | "bearer_token";
    login: string;
    githubUserId?: number;
    installationIds?: readonly number[];
  };
  /** Authoritative database values for the installation-scoped repository. */
  repository: {
    installationId: number;
    repositoryId: string;
    githubRepositoryId: number;
    owner: string;
    name: string;
    defaultBranch: string;
  };
  /** An explicit operator request, never a pull request or webhook base ref. */
  intent: {
    kind: "protected-branch";
    ref: string;
    sha: string;
    requestId: string;
  };
  installation: { id: number; token: string };
  apiBaseUrl: string;
  request?: Request;
};

const localRepositoryIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const shaPattern = /^[0-9a-f]{40}$/u;

/** Never call this helper with untrusted actor/session or repository records. */
export async function inspectProtectedReleaseIntentCandidate(
  input: ProtectedReleaseRequestInput,
): Promise<ProtectedReleaseIntentCandidate | undefined> {
  const { actor, repository, installation, intent } = input;
  if (
    actor.authType !== "session" ||
    !Number.isSafeInteger(actor.githubUserId) ||
    !actor.githubUserId ||
    actor.githubUserId <= 0 ||
    !Array.isArray(actor.installationIds) ||
    !actor.installationIds.includes(repository.installationId) ||
    !Number.isSafeInteger(repository.installationId) ||
    repository.installationId <= 0 ||
    !Number.isSafeInteger(repository.githubRepositoryId) ||
    repository.githubRepositoryId <= 0 ||
    !localRepositoryIdPattern.test(repository.repositoryId) ||
    installation.id !== repository.installationId ||
    !installation.token ||
    intent.kind !== "protected-branch" ||
    !idempotencyKeyPattern.test(intent.requestId) ||
    !shaPattern.test(intent.sha) ||
    intent.ref !== `refs/heads/${repository.defaultBranch}`
  )
    return undefined;

  const shared = {
    apiBaseUrl: input.apiBaseUrl,
    token: installation.token,
    owner: repository.owner,
    repository: repository.name,
    ...(input.request ? { request: input.request } : {}),
  };
  const branch = await inspectProtectedBranchHead({
    ...shared,
    repositoryId: repository.githubRepositoryId,
    branch: repository.defaultBranch,
    ref: intent.ref,
    sha: intent.sha,
  });
  if (!branch) return undefined;

  const role = await inspectProtectedReleaseOperator({
    ...shared,
    actorLogin: actor.login,
    actorGithubUserId: actor.githubUserId,
  });
  if (!role) return undefined;

  const material = {
    version: 2 as const,
    kind: "protected-branch" as const,
    installationId: repository.installationId,
    repositoryId: repository.repositoryId,
    githubRepositoryId: repository.githubRepositoryId,
    githubOwnerId: branch.githubOwnerId,
    actorGithubUserId: actor.githubUserId,
    actorLogin: actor.login,
    ref: branch.ref,
    sha: branch.sha,
    requestId: intent.requestId,
  };
  return { ...material, digest: createHash("sha256").update(JSON.stringify(material)).digest("hex") };
}
