import { createHash, timingSafeEqual } from "node:crypto";
import type { SqlQueryExecutor } from "@boardreadyops/db";
import { remoteMcpResource, remoteReviewFacts } from "./remote-mcp-foundation.js";
import { notCancelledSubscription } from "./tenant-scope.js";

/**
 * Claims returned ONLY by a signature-verifying OAuth access-token verifier. Never
 * construct these from client JSON, browser cookies or a repository API token.
 * The future authorization server binds the authenticated GitHub account to sub.
 */
export interface SignedRemoteMcpClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  nbf?: number;
  scope: string;
  githubUserId: number;
}

export interface RemoteMcpPrincipal {
  githubUserId: number;
  grantId: string;
  scopes: readonly string[];
}

export interface RemoteMcpTokenVerifier {
  /** Must authenticate the JWT signature and trusted issuer keys; return null on failure. */
  verifySignedAccessToken(token: string): Promise<SignedRemoteMcpClaims | null>;
  /** Must check a durable revocation/grant store on EACH request, not an in-memory cache. */
  grantIsActive(jti: string, githubUserId: number): Promise<boolean>;
}

const bearerTokenPattern = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/u;
const maximumTokenLength = 4096;
const maximumTokenLifetimeSeconds = 3600;
const clockSkewSeconds = 60;
const pkceVerifierPattern = /^[A-Za-z0-9._~-]{43,128}$/u;
const pkceChallengePattern = /^[A-Za-z0-9_-]{43}$/u;

/** RFC 7636 S256 only, used when issuing OAuth authorization codes. No `plain` fallback. */
export function verifyPkceS256(codeVerifier: string, expectedChallenge: string, method: string): boolean {
  if (method !== "S256" || !pkceVerifierPattern.test(codeVerifier) || !pkceChallengePattern.test(expectedChallenge))
    return false;
  const candidate = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  return timingSafeEqual(Buffer.from(candidate, "ascii"), Buffer.from(expectedChallenge, "ascii"));
}

/**
 * OAuth resource-server boundary. This deliberately does not accept legacy API
 * tokens or user sessions. No live verifier is configured yet (#1248): /mcp remains
 * disabled until the full issuer/PKCE/token-revocation flow is implemented.
 */
export async function authenticateRemoteMcpRequest(
  request: Request,
  expectedIssuer: string,
  verifier: RemoteMcpTokenVerifier,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RemoteMcpPrincipal | null> {
  if (request.url.length > 4096 || new URL(request.url).searchParams.has("access_token")) return null;
  try {
    const parsedIssuer = new URL(expectedIssuer);
    if (
      parsedIssuer.protocol !== "https:" ||
      parsedIssuer.username ||
      parsedIssuer.password ||
      parsedIssuer.search ||
      parsedIssuer.hash ||
      (parsedIssuer.toString() !== expectedIssuer && parsedIssuer.toString() !== `${expectedIssuer}/`)
    )
      return null;
  } catch {
    return null;
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = bearerTokenPattern.exec(authorization)?.[1];
  if (!token || token.length > maximumTokenLength) return null;

  let claims: SignedRemoteMcpClaims | null;
  try {
    claims = await verifier.verifySignedAccessToken(token);
  } catch {
    return null;
  }
  if (
    !claims ||
    claims.iss !== expectedIssuer ||
    !(typeof claims.aud === "string"
      ? claims.aud === remoteMcpResource
      : Array.isArray(claims.aud) && claims.aud.includes(remoteMcpResource)) ||
    !Number.isSafeInteger(claims.githubUserId) ||
    claims.githubUserId <= 0 ||
    claims.sub !== `github:${claims.githubUserId}` ||
    typeof claims.jti !== "string" ||
    claims.jti.length === 0 ||
    claims.jti.length > 128 ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.iat > nowSeconds + clockSkewSeconds ||
    claims.exp <= nowSeconds ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > maximumTokenLifetimeSeconds ||
    (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds + clockSkewSeconds)) ||
    typeof claims.scope !== "string" ||
    claims.scope.length > 256
  )
    return null;

  const scopes = claims.scope.split(" ").filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => scope !== "review:read" && scope !== "evidence:read")) return null;
  try {
    if (!(await verifier.grantIsActive(claims.jti, claims.githubUserId))) return null;
  } catch {
    return null;
  }
  return { githubUserId: claims.githubUserId, grantId: claims.jti, scopes };
}

/** Current repository permission, NOT a login-time installation snapshot. */
interface RemoteMcpRepositoryGrant {
  githubUserId: number;
  githubRepositoryId: number;
  githubInstallationId: number;
  owner: string;
  name: string;
}

export type CheckLiveRepositoryPermission = (grant: RemoteMcpRepositoryGrant) => Promise<boolean>;

type AuthorizedReviewRow = {
  id: string;
  repository_id: string;
  head_run_id: string;
  current_revision_id: string | null;
  status: string;
  decision: string;
  owner: string;
  name: string;
  github_repo_id: string | number;
  github_installation_id: string | number;
};

type AuthorizedRevisionRow = { head_commit_sha: string; evidence_digest: string };

function validGitHubId(input: string | number): number | null {
  const value = Number(input);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Read one live hosted Review only if a separately verified user still has GitHub
 * read authority for its owning repository. A GitHub App installation alone is NOT
 * user permission. No workspace name alias, demo fixture or public fallback exists.
 *
 * Missing data and denied access both return null (avoid cross-tenant enumeration).
 */
export async function loadAuthorizedRemoteReview(
  db: Pick<SqlQueryExecutor, "query">,
  principal: RemoteMcpPrincipal,
  reviewId: string,
  checkCurrentPermission: CheckLiveRepositoryPermission,
): Promise<ReturnType<typeof remoteReviewFacts> | null> {
  if (!principal.scopes.includes("review:read") || !/^[a-f0-9-]{36}$/iu.test(reviewId)) return null;
  const result = await db.query(
    `select reviews.id, reviews.repository_id, reviews.head_run_id, reviews.current_revision_id,
            reviews.status, reviews.decision, repositories.owner, repositories.name,
            repositories.github_repo_id, installations.github_installation_id
       from reviews
       join repositories on repositories.id = reviews.repository_id
       join installations on installations.id = repositories.installation_id
      where reviews.id = $1
        and repositories.disabled_at is null
        and installations.suspended_at is null
        and ${notCancelledSubscription}
      limit 1`,
    [reviewId],
  );
  const row = ((result as { rows?: AuthorizedReviewRow[] }).rows ?? [])[0];
  if (!row || row.id !== reviewId || !row.current_revision_id) return null;
  const githubRepositoryId = validGitHubId(row.github_repo_id);
  const githubInstallationId = validGitHubId(row.github_installation_id);
  if (!githubRepositoryId || !githubInstallationId) return null;

  let permitted = false;
  try {
    permitted = await checkCurrentPermission({
      githubUserId: principal.githubUserId,
      githubRepositoryId,
      githubInstallationId,
      owner: row.owner,
      name: row.name,
    });
  } catch {
    return null;
  }
  if (!permitted) return null;

  const revision = await db.query(
    `select head_commit_sha, evidence_digest from review_revisions
      where id = $1 and review_id = $2 and head_run_id = $3
      limit 1`,
    [row.current_revision_id, row.id, row.head_run_id],
  );
  const current = ((revision as { rows?: AuthorizedRevisionRow[] }).rows ?? [])[0];
  if (!current) return null;
  return remoteReviewFacts({
    status: row.status as Parameters<typeof remoteReviewFacts>[0]["status"],
    decision: row.decision as Parameters<typeof remoteReviewFacts>[0]["decision"],
    headCommitSha: current.head_commit_sha,
    evidenceDigest: current.evidence_digest,
  });
}
