/**
 * Evidence for a protected GitHub branch HEAD, not permission to execute a release.
 *
 * A verified GitHub event expressing release intent, an authoritative installation /
 * repository binding and an immutable run snapshot must still be established by
 * the caller. Neither a PR's base branch nor this read-only result grants authority.
 */
export type ProtectedBranchHeadEvidence = {
  source: "github-active-branch-rules";
  /** Verified numeric owner identity, stable across both GitHub repository reads. */
  githubOwnerId: number;
  ref: string;
  sha: string;
  requiredRuleTypes: ["pull_request", "required_status_checks"];
};

type Request = (url: string, init?: RequestInit) => Promise<Response>;

export type ProtectedBranchHeadInput = {
  apiBaseUrl: string;
  /** An installation-scoped token acquired for the authoritative repository. */
  token: string;
  owner: string;
  repository: string;
  /** Numeric GitHub repository ID resolved from authoritative installation-scoped state. */
  repositoryId: number;
  /** Trusted target branch name, not a user-submitted PR base branch. */
  branch: string;
  ref: string;
  sha: string;
  request?: Request;
};

const repositoryComponent = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;
const branchComponent = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const exactSha = /^[0-9a-f]{40}$/u;

function validBranch(branch: string): boolean {
  return (
    branchComponent.test(branch) &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    branch.split("/").every((part) => part !== "." && part !== ".." && !part.endsWith(".lock"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function githubOwnerId(body: unknown, expectedOwner: string): number | undefined {
  if (!isRecord(body) || !isRecord(body.owner)) return undefined;
  const id = body.owner.id;
  if (
    !Number.isSafeInteger(id) ||
    typeof id !== "number" ||
    id <= 0 ||
    typeof body.owner.login !== "string" ||
    body.owner.login.toLowerCase() !== expectedOwner.toLowerCase()
  )
    return undefined;
  return id;
}

function repositoryMatches(
  body: unknown,
  owner: string,
  repository: string,
  repositoryId: number,
  expectedBranch: string,
): boolean {
  return (
    isRecord(body) &&
    body.id === repositoryId &&
    typeof body.full_name === "string" &&
    body.full_name.toLowerCase() === `${owner}/${repository}`.toLowerCase() &&
    body.default_branch === expectedBranch &&
    body.archived === false &&
    body.disabled === false &&
    body.private === false
  );
}

function branchMatches(body: unknown, expectedBranch: string, sha: string): boolean {
  return (
    isRecord(body) &&
    body.name === expectedBranch &&
    body.protected === true &&
    isRecord(body.commit) &&
    body.commit.sha === sha
  );
}

function meaningfulRules(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const rules = value.filter(isRecord);
  const hasReviewGate = rules.some(
    (rule) =>
      rule.type === "pull_request" &&
      isRecord(rule.parameters) &&
      rule.parameters.required_review_thread_resolution === true,
  );
  const hasRequiredChecks = rules.some(
    (rule) =>
      rule.type === "required_status_checks" &&
      isRecord(rule.parameters) &&
      Array.isArray(rule.parameters.required_status_checks) &&
      rule.parameters.required_status_checks.length > 0 &&
      rule.parameters.strict_required_status_checks_policy === true,
  );
  return hasReviewGate && hasRequiredChecks;
}

async function readJson(request: Request, url: string, token: string): Promise<unknown> {
  const response = await request(url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return undefined;
  return response.json();
}

function validGitHubApiOrigin(apiBaseUrl: string): boolean {
  if (!URL.canParse(apiBaseUrl)) return false;
  const base = new URL(apiBaseUrl);
  return (
    base.protocol === "https:" &&
    base.hostname === "api.github.com" &&
    !base.port &&
    base.pathname === "/" &&
    !base.username &&
    !base.password &&
    !base.search &&
    !base.hash
  );
}

function validRepositoryTarget(
  input: Pick<ProtectedBranchHeadInput, "owner" | "repository" | "token" | "apiBaseUrl">,
): boolean {
  return (
    repositoryComponent.test(input.owner) &&
    repositoryComponent.test(input.repository) &&
    Boolean(input.token) &&
    validGitHubApiOrigin(input.apiBaseUrl)
  );
}

function validProtectedBranchRequest(input: ProtectedBranchHeadInput): boolean {
  return (
    validRepositoryTarget(input) &&
    Number.isSafeInteger(input.repositoryId) &&
    input.repositoryId > 0 &&
    validBranch(input.branch) &&
    input.ref === `refs/heads/${input.branch}` &&
    exactSha.test(input.sha)
  );
}

function validOperatorRequest(
  input: Pick<ProtectedBranchHeadInput, "owner" | "repository" | "token" | "apiBaseUrl"> & {
    actorLogin: string;
    actorGithubUserId: number;
  },
): boolean {
  const githubLogin = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/iu;
  return (
    validRepositoryTarget(input) &&
    githubLogin.test(input.actorLogin) &&
    Number.isSafeInteger(input.actorGithubUserId) &&
    input.actorGithubUserId > 0
  );
}

function adminPermissionMatches(evidence: unknown, actorId: number, actorLogin: string): boolean {
  return (
    isRecord(evidence) &&
    evidence.permission === "admin" &&
    isRecord(evidence.user) &&
    evidence.user.id === actorId &&
    typeof evidence.user.login === "string" &&
    evidence.user.login.toLowerCase() === actorLogin.toLowerCase()
  );
}

/**
 * Check branch HEAD before and after retrieving *effective* GitHub branch
 * rules, rejecting moved refs, missing rules, incomplete permissions and
 * malformed responses. The snapshot is only evidence of branch protection
 * at observation time; it is NOT release intent or production authorization.
 */
export async function inspectProtectedBranchHead(
  input: ProtectedBranchHeadInput,
): Promise<ProtectedBranchHeadEvidence | undefined> {
  if (!validProtectedBranchRequest(input)) return undefined;

  // URLs and the token are operational configuration, never derived from a PR.
  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/u, "");
  const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
  const repoPath = path;
  const branchPath = `${path}/branches/${encodeURIComponent(input.branch)}`;
  const rulesPath = `${path}/rules/branches/${encodeURIComponent(input.branch)}`;
  const request = input.request ?? fetch;
  try {
    const repoBefore = await readJson(request, `${apiBaseUrl}${repoPath}`, input.token);
    if (!repositoryMatches(repoBefore, input.owner, input.repository, input.repositoryId, input.branch))
      return undefined;
    const ownerId = githubOwnerId(repoBefore, input.owner);
    if (!ownerId) return undefined;
    const before = await readJson(request, `${apiBaseUrl}${branchPath}`, input.token);
    if (!branchMatches(before, input.branch, input.sha)) return undefined;
    const rules = await readJson(request, `${apiBaseUrl}${rulesPath}`, input.token);
    if (!meaningfulRules(rules)) return undefined;
    const after = await readJson(request, `${apiBaseUrl}${branchPath}`, input.token);
    if (!branchMatches(after, input.branch, input.sha)) return undefined;
    const repoAfter = await readJson(request, `${apiBaseUrl}${repoPath}`, input.token);
    if (
      !repositoryMatches(repoAfter, input.owner, input.repository, input.repositoryId, input.branch) ||
      githubOwnerId(repoAfter, input.owner) !== ownerId
    )
      return undefined;
    return {
      source: "github-active-branch-rules",
      githubOwnerId: ownerId,
      ref: input.ref,
      sha: input.sha,
      requiredRuleTypes: ["pull_request", "required_status_checks"],
    };
  } catch {
    // Deliberately do not surface raw provider responses or credentials.
    return undefined;
  }
}

/**
 * Observe a repository administrator using an installation token bound to the
 * same repository. Only call this with an authenticated GitHub session's user
 * identity and an authoritative stored installation/repository association.
 *
 * This is identity/role evidence, NOT a release authorization. The caller
 * must still obtain explicit operator intent and store it immutably.
 */
export async function inspectProtectedReleaseOperator(
  input: Pick<ProtectedBranchHeadInput, "apiBaseUrl" | "token" | "owner" | "repository" | "request"> & {
    actorLogin: string;
    actorGithubUserId: number;
  },
): Promise<{ source: "github-repository-admin"; actorGithubUserId: number } | undefined> {
  if (!validOperatorRequest(input)) return undefined;

  const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
  const endpoint = `${input.apiBaseUrl.replace(/\/$/u, "")}${path}/collaborators/${encodeURIComponent(input.actorLogin)}/permission`;
  try {
    const evidence = await readJson(input.request ?? fetch, endpoint, input.token);
    if (!adminPermissionMatches(evidence, input.actorGithubUserId, input.actorLogin)) return undefined;
    return {
      source: "github-repository-admin",
      actorGithubUserId: input.actorGithubUserId,
    };
  } catch {
    return undefined;
  }
}
