/**
 * Strict subject validation for a future persisted protected-release snapshot.
 *
 * This deliberately does not authorize any workflow or expose an HTTP route.
 * The caller must first verify the JWT signature, issuer, audience, workflow,
 * ref, run/attempt and SHA and load immutable expectations from the database.
 * GitHub's default legacy and immutable subjects are supported. Custom
 * organization/repository sub templates are not accepted without a separately
 * reviewed explicit profile.
 */
export type ProtectedReleaseSubjectExpectation = {
  repository: string;
  repositoryId: string;
  /** Immutable GitHub owner ID from independently verified persisted authority. */
  repositoryOwnerId: string;
  ref: string;
};

type SignedClaims = Readonly<Record<string, unknown>>;

function numericId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 16 || !/^[1-9]\d*$/u.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? value : undefined;
}

export function protectedReleaseSubjectMatches(
  payload: SignedClaims,
  expected: ProtectedReleaseSubjectExpectation,
): boolean {
  const repositoryId = numericId(expected.repositoryId);
  const actualRepositoryId = numericId(payload.repository_id);
  const ownerId = numericId(expected.repositoryOwnerId);
  const actualOwnerId = numericId(payload.repository_owner_id);
  if (
    !repositoryId ||
    !ownerId ||
    !actualRepositoryId ||
    !actualOwnerId ||
    actualRepositoryId !== repositoryId ||
    actualOwnerId !== ownerId ||
    typeof payload.repository !== "string" ||
    payload.repository !== expected.repository ||
    typeof payload.ref !== "string" ||
    payload.ref !== expected.ref ||
    typeof payload.sub !== "string"
  )
    return false;

  const [owner, name, ...remainder] = expected.repository.split("/");
  if (!owner || !name || remainder.length !== 0 || !expected.ref.startsWith("refs/heads/")) return false;

  const legacy = `repo:${owner}/${name}:ref:${expected.ref}`;
  if (payload.sub === legacy) return true;

  const immutable = `repo:${owner}@${ownerId}/${name}@${repositoryId}:ref:${expected.ref}`;
  return payload.sub === immutable;
}
