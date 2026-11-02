import { createPublicKey, verify } from "node:crypto";

const githubActionsOidcIssuer = "https://token.actions.githubusercontent.com";
const githubActionsOidcJwksUrl = `${githubActionsOidcIssuer}/.well-known/jwks`;
const defaultRepository = "oaslananka/boardreadyops";
const defaultWorkflowRef = `${defaultRepository}/.github/workflows/readiness-runner.yml@refs/heads/main`;
const maximumTokenLifetimeSeconds = 15 * 60;
const clockToleranceSeconds = 30;
const jwksCacheLifetimeMs = 5 * 60 * 1000;

let cachedJwks;
let cachedJwksExpiresAt = 0;

function decodeJsonSegment(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

function stringClaim(payload, name) {
  const value = payload[name];
  return typeof value === "string" ? value : undefined;
}

function integerClaim(payload, name) {
  const value = payload[name];
  return Number.isSafeInteger(value) ? value : undefined;
}

function audienceMatches(audience, expected) {
  if (typeof audience === "string") {
    return audience === expected;
  }

  return Array.isArray(audience) && audience.length === 1 && audience[0] === expected;
}

function claimsAreTrusted(payload, expectations, nowSeconds) {
  const issuedAt = integerClaim(payload, "iat");
  const notBefore = integerClaim(payload, "nbf");
  const expiresAt = integerClaim(payload, "exp");

  if (issuedAt === undefined || notBefore === undefined || expiresAt === undefined) {
    return false;
  }

  if (
    issuedAt > nowSeconds + clockToleranceSeconds ||
    notBefore > nowSeconds + clockToleranceSeconds ||
    expiresAt <= nowSeconds - clockToleranceSeconds ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maximumTokenLifetimeSeconds ||
    issuedAt < nowSeconds - maximumTokenLifetimeSeconds
  ) {
    return false;
  }

  return (
    stringClaim(payload, "iss") === githubActionsOidcIssuer &&
    audienceMatches(
      payload.aud,
      expectations.audience ??
        (expectations.executionAttemptId
          ? `boardreadyops-cloud:${expectations.runId}:${expectations.executionAttemptId}`
          : `boardreadyops-cloud:${expectations.runId}`),
    ) &&
    stringClaim(payload, "repository") === expectations.repository &&
    (expectations.repositoryId === undefined || stringClaim(payload, "repository_id") === expectations.repositoryId) &&
    stringClaim(payload, "workflow_ref") === expectations.workflowRef &&
    (expectations.githubRunId === undefined || stringClaim(payload, "run_id") === expectations.githubRunId) &&
    stringClaim(payload, "ref") === expectations.ref &&
    (expectations.sha === undefined || stringClaim(payload, "sha") === expectations.sha) &&
    stringClaim(payload, "event_name") === "workflow_dispatch" &&
    stringClaim(payload, "runner_environment") === "github-hosted"
  );
}

async function loadGitHubJwks(fetchImpl, nowMs) {
  if (cachedJwks && cachedJwksExpiresAt > nowMs) {
    return cachedJwks;
  }

  const response = await fetchImpl(githubActionsOidcJwksUrl, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`GitHub Actions JWKS request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  if (typeof body !== "object" || body === null || !Array.isArray(body.keys)) {
    throw new Error("GitHub Actions JWKS response is invalid");
  }

  cachedJwks = body.keys;
  cachedJwksExpiresAt = nowMs + jwksCacheLifetimeMs;
  return cachedJwks;
}

export function resetGitHubActionsOidcJwksCache() {
  cachedJwks = undefined;
  cachedJwksExpiresAt = 0;
}

export async function verifyGitHubActionsOidcTokenClaims(
  token,
  {
    runId,
    executionAttemptId,
    audience,
    repository = defaultRepository,
    repositoryId,
    githubRunId,
    workflowRef = defaultWorkflowRef,
    ref = "refs/heads/main",
    sha,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  },
) {
  if (typeof token !== "string" || token.length < 100 || token.length > 20_000 || typeof fetchImpl !== "function") {
    return undefined;
  }

  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    return undefined;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeJsonSegment(encodedHeader);
  const payload = decodeJsonSegment(encodedPayload);

  if (
    !header ||
    !payload ||
    header.alg !== "RS256" ||
    header.typ !== "JWT" ||
    typeof header.kid !== "string" ||
    header.kid.length === 0 ||
    !claimsAreTrusted(
      payload,
      { runId, executionAttemptId, audience, repository, repositoryId, githubRunId, workflowRef, ref, sha },
      Math.floor(now() / 1000),
    )
  ) {
    return undefined;
  }

  try {
    const keys = await loadGitHubJwks(fetchImpl, now());
    const matchingKeys = keys.filter(
      (key) =>
        typeof key === "object" &&
        key !== null &&
        key.kid === header.kid &&
        key.kty === "RSA" &&
        (key.alg === undefined || key.alg === "RS256") &&
        (key.use === undefined || key.use === "sig"),
    );

    if (matchingKeys.length !== 1) {
      return undefined;
    }

    const publicKey = createPublicKey({ key: matchingKeys[0], format: "jwk" });
    const signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!signatureValid) return undefined;

    // These fields are now backed by GitHub's verified signature, not request headers.
    const workflowSha = stringClaim(payload, "sha");
    const workflowRunId = stringClaim(payload, "run_id");
    if (!workflowSha || !/^[0-9a-f]{40}$/u.test(workflowSha) || !workflowRunId) return undefined;
    return {
      workflowSha,
      workflowRunId,
      repository: stringClaim(payload, "repository"),
      repositoryId: stringClaim(payload, "repository_id"),
      workflowRef: stringClaim(payload, "workflow_ref"),
      ref: stringClaim(payload, "ref"),
      event: stringClaim(payload, "event_name"),
      runnerEnvironment: stringClaim(payload, "runner_environment"),
    };
  } catch {
    return undefined;
  }
}

export async function verifyGitHubActionsOidcToken(token, options) {
  return (await verifyGitHubActionsOidcTokenClaims(token, options)) !== undefined;
}
