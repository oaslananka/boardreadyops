/**
 * Evidence for a protected GitHub branch HEAD, not permission to execute a release.
 *
 * A verified GitHub event expressing release intent, an authoritative installation /
 * repository binding and an immutable run snapshot must still be established by
 * the caller. Neither a PR's base branch nor this read-only result grants authority.
 */
export type ProtectedBranchHeadEvidence = {
  source: "github-active-branch-rules";
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

/**
 * Check branch HEAD before and after retrieving *effective* GitHub branch
 * rules, rejecting moved refs, missing rules, incomplete permissions and
 * malformed responses. The snapshot is only evidence of branch protection
 * at observation time; it is NOT release intent or production authorization.
 */
export async function inspectProtectedBranchHead(
  input: ProtectedBranchHeadInput,
): Promise<ProtectedBranchHeadEvidence | undefined> {
  if (
    !repositoryComponent.test(input.owner) ||
    !repositoryComponent.test(input.repository) ||
    !validBranch(input.branch) ||
    input.ref !== `refs/heads/${input.branch}` ||
    !exactSha.test(input.sha) ||
    !input.token ||
    !URL.canParse(input.apiBaseUrl)
  )
    return undefined;

  const base = new URL(input.apiBaseUrl);
  if (
    base.protocol !== "https:" ||
    base.hostname !== "api.github.com" ||
    base.port ||
    base.pathname !== "/" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    return undefined;

  // URLs and the token are operational configuration, never derived from a PR.
  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/u, "");
  const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
  const branchPath = `${path}/branches/${encodeURIComponent(input.branch)}`;
  const rulesPath = `${path}/rules/branches/${encodeURIComponent(input.branch)}`;
  const request = input.request ?? fetch;
  try {
    const before = await readJson(request, `${apiBaseUrl}${branchPath}`, input.token);
    if (!branchMatches(before, input.branch, input.sha)) return undefined;
    const rules = await readJson(request, `${apiBaseUrl}${rulesPath}`, input.token);
    if (!meaningfulRules(rules)) return undefined;
    const after = await readJson(request, `${apiBaseUrl}${branchPath}`, input.token);
    if (!branchMatches(after, input.branch, input.sha)) return undefined;
    return {
      source: "github-active-branch-rules",
      ref: input.ref,
      sha: input.sha,
      requiredRuleTypes: ["pull_request", "required_status_checks"],
    };
  } catch {
    // Deliberately do not surface raw provider responses or credentials.
    return undefined;
  }
}
