export type GitHubPermissionLevel = "admin" | "none" | "read" | "write";

export interface GitHubAppPermissions {
  metadata?: GitHubPermissionLevel;
  checks?: GitHubPermissionLevel;
  actions?: GitHubPermissionLevel;
  pullRequests?: GitHubPermissionLevel;
  issues?: GitHubPermissionLevel;
  contents?: GitHubPermissionLevel;
  workflows?: GitHubPermissionLevel;
  [key: string]: GitHubPermissionLevel | undefined;
}

export interface GitHubAppCapabilities {
  metadataRead: boolean;
  checksRead: boolean;
  checksWrite: boolean;
  actionsRead: boolean;
  actionsDispatch: boolean;
  pullRequestsRead: boolean;
  pullRequestsWrite: boolean;
  issuesRead: boolean;
  issuesWrite: boolean;
  contentsRead: boolean;
  contentsWrite: boolean;
  workflowsRead: boolean;
  workflowsWrite: boolean;

  // Compound capabilities for product workflows
  canInspectReadiness: boolean;
  canDispatchAnalysis: boolean;
  canPostPrComments: boolean;
  canCreateCheckRunActions: boolean;
  canCreateSetupPr: boolean;
  canCreateRemediationPr: boolean;
  canCreateWaiverPr: boolean;
}

export type CapabilityRequirement =
  | "check_run_actions"
  | "dispatch_analysis"
  | "pr_comment"
  | "remediation_pr"
  | "setup_pr"
  | "waiver_pr";

export interface CapabilityCheckResult {
  satisfied: boolean;
  missingPermissions: string[];
  userExplanation?: string;
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase().replace(/[_-]/gu, "");
  if (lower === "pullrequests" || lower === "pullrequest" || lower === "pulls") return "pullRequests";
  if (lower === "workflows" || lower === "workflow") return "workflows";
  if (lower === "contents" || lower === "content") return "contents";
  if (lower === "actions" || lower === "action") return "actions";
  if (lower === "checks" || lower === "check") return "checks";
  if (lower === "issues" || lower === "issue") return "issues";
  if (lower === "metadata") return "metadata";
  return key;
}

function hasWrite(level: string | undefined): boolean {
  if (!level) return false;
  const normalized = level.toLowerCase();
  return normalized === "write" || normalized === "admin";
}

function hasRead(level: string | undefined): boolean {
  if (!level) return false;
  const normalized = level.toLowerCase();
  return normalized === "read" || normalized === "write" || normalized === "admin";
}

export function evaluateAppCapabilities(
  permissions: Record<string, string | undefined> | GitHubAppPermissions = {},
): GitHubAppCapabilities {
  const normalizedMap = new Map<string, string>();
  for (const [k, v] of Object.entries(permissions)) {
    if (typeof v === "string") {
      normalizedMap.set(normalizeKey(k), v);
    }
  }

  const metadataLevel = normalizedMap.get("metadata");
  const checksLevel = normalizedMap.get("checks");
  const actionsLevel = normalizedMap.get("actions");
  const prLevel = normalizedMap.get("pullRequests");
  const issuesLevel = normalizedMap.get("issues");
  const contentsLevel = normalizedMap.get("contents");
  const workflowsLevel = normalizedMap.get("workflows");

  const metadataRead = hasRead(metadataLevel);
  const checksRead = hasRead(checksLevel);
  const checksWrite = hasWrite(checksLevel);
  const actionsRead = hasRead(actionsLevel);
  const actionsDispatch = hasWrite(actionsLevel);
  const pullRequestsRead = hasRead(prLevel);
  const pullRequestsWrite = hasWrite(prLevel);
  const issuesRead = hasRead(issuesLevel);
  const issuesWrite = hasWrite(issuesLevel);
  const contentsRead = hasRead(contentsLevel);
  const contentsWrite = hasWrite(contentsLevel);
  const workflowsRead = hasRead(workflowsLevel);
  const workflowsWrite = hasWrite(workflowsLevel);

  const canInspectReadiness = checksWrite && actionsRead;
  const canDispatchAnalysis = actionsDispatch;
  const canPostPrComments = pullRequestsWrite || issuesWrite;
  const canCreateCheckRunActions = checksWrite;
  const canCreateSetupPr = contentsWrite && workflowsWrite && pullRequestsWrite;
  const canCreateRemediationPr = contentsWrite && pullRequestsWrite;
  const canCreateWaiverPr = contentsWrite && pullRequestsWrite;

  return {
    metadataRead,
    checksRead,
    checksWrite,
    actionsRead,
    actionsDispatch,
    pullRequestsRead,
    pullRequestsWrite,
    issuesRead,
    issuesWrite,
    contentsRead,
    contentsWrite,
    workflowsRead,
    workflowsWrite,
    canInspectReadiness,
    canDispatchAnalysis,
    canPostPrComments,
    canCreateCheckRunActions,
    canCreateSetupPr,
    canCreateRemediationPr,
    canCreateWaiverPr,
  };
}

type RequirementRule = {
  getMissing: (c: GitHubAppCapabilities) => string[];
  explanation: string;
};

const REQUIREMENT_RULES: Record<CapabilityRequirement, RequirementRule> = {
  setup_pr: {
    getMissing: (c) => [
      ...(!c.contentsWrite ? ["contents:write"] : []),
      ...(!c.workflowsWrite ? ["workflows:write"] : []),
      ...(!c.pullRequestsWrite ? ["pull_requests:write"] : []),
    ],
    explanation:
      "Automated setup PR creation requires Contents (write), Workflows (write), and Pull requests (write) permissions. Please update App permissions or use manual setup.",
  },
  remediation_pr: {
    getMissing: (c) => [
      ...(!c.contentsWrite ? ["contents:write"] : []),
      ...(!c.pullRequestsWrite ? ["pull_requests:write"] : []),
    ],
    explanation: "Automated remediation PR creation requires Contents (write) and Pull requests (write) permissions.",
  },
  waiver_pr: {
    getMissing: (c) => [
      ...(!c.contentsWrite ? ["contents:write"] : []),
      ...(!c.pullRequestsWrite ? ["pull_requests:write"] : []),
    ],
    explanation: "Creating waiver PRs requires Contents (write) and Pull requests (write) permissions.",
  },
  pr_comment: {
    getMissing: (c) => (!c.canPostPrComments ? ["pull_requests:write"] : []),
    explanation: "Posting PR comments requires Pull requests (write) or Issues (write) permission.",
  },
  check_run_actions: {
    getMissing: (c) => (!c.canCreateCheckRunActions ? ["checks:write"] : []),
    explanation: "Interactive Check Run actions require Checks (write) permission.",
  },
  dispatch_analysis: {
    getMissing: (c) => (!c.canDispatchAnalysis ? ["actions:write"] : []),
    explanation: "Dispatching analysis workflows requires Actions (write) permission.",
  },
};

export function checkCapabilityRequirement(
  capabilities: GitHubAppCapabilities,
  requirement: CapabilityRequirement,
): CapabilityCheckResult {
  const rule = REQUIREMENT_RULES[requirement];
  const missing = rule.getMissing(capabilities);
  if (missing.length > 0) {
    return {
      satisfied: false,
      missingPermissions: missing,
      userExplanation: rule.explanation,
    };
  }
  return { satisfied: true, missingPermissions: [] };
}

/**
 * The declared GitHub App permission profile.
 *
 * This is the single source of truth for what the App asks for and why. Three places used to
 * carry their own copy of this list and had drifted apart: the public `/setup` page claimed
 * `contents: none` and `pull_requests: read`, `handleRepositorySetupGet`'s response claimed
 * `contents: write` and `pull_requests: write`, and the ops canary runbook instructed operators
 * to refuse any installation that requested Contents at all. The capability evaluator above and
 * `GitHubMutationService` were both written against the broad profile, so the narrow claims
 * described a product that could not open a setup, waiver, or remediation pull request.
 *
 * `requirement` separates the permissions without which nothing works from the ones that buy a
 * specific capability. `degradation` is the user-facing sentence shown when a permission is
 * absent, so no surface has to invent its own wording for a missing grant.
 */
export type GitHubAppPermissionRequirement = "capability" | "core";

export type GitHubAppPermissionScope = "account" | "organization" | "repository";

export type GitHubAppPermissionLevel = Extract<GitHubPermissionLevel, "read" | "write">;

export type GitHubAppPermissionDeclaration = {
  /** GitHub's API key for the permission, as it appears in an installation's `permissions` object. */
  key: string;
  /** The permission's name on GitHub's own installation and authorization screens. */
  label: string;
  level: GitHubAppPermissionLevel;
  scope: GitHubAppPermissionScope;
  requirement: GitHubAppPermissionRequirement;
  /** What the product does with the grant, in terms a reviewer of the install prompt can check. */
  purpose: string;
  /** What stops working when the grant is absent. Rendered verbatim by the setup and repository pages. */
  degradation: string;
};

export const githubAppPermissionProfile: readonly GitHubAppPermissionDeclaration[] = [
  {
    key: "metadata",
    label: "Metadata",
    level: "read",
    scope: "repository",
    requirement: "core",
    purpose: "Bind the installation to the intended repository and follow installation lifecycle events.",
    degradation: "BoardReadyOps cannot identify the repository. Nothing runs without this grant.",
  },
  {
    key: "checks",
    label: "Checks",
    level: "write",
    scope: "repository",
    requirement: "core",
    purpose: "Publish the readiness Check Run, inline annotations, and its interactive action buttons.",
    degradation: "Results are posted as a pull request comment and in the dashboard instead of a native Check Run.",
  },
  {
    key: "actions",
    label: "Actions",
    level: "write",
    scope: "repository",
    requirement: "core",
    purpose: "Dispatch the repository-owned readiness workflow on pull request events and re-run requests.",
    degradation: "Runs must be triggered by pushing a commit or by starting the workflow from the Actions tab.",
  },
  {
    key: "pull_requests",
    label: "Pull requests",
    level: "write",
    scope: "repository",
    requirement: "capability",
    purpose: "Open setup, waiver, and remediation pull requests, and keep one readiness summary comment current.",
    degradation: "Automated pull requests and the summary comment are unavailable; the Check Run stays authoritative.",
  },
  {
    key: "contents",
    label: "Contents",
    level: "write",
    scope: "repository",
    requirement: "capability",
    purpose:
      "Commit only boardreadyops.yml, .github/workflows/readiness-runner.yml, and .boardreadyops/** to a new branch for review, never to the default branch.",
    degradation: "One-click setup and remediation are replaced by copy-ready files you commit yourself.",
  },
  {
    key: "workflows",
    label: "Workflows",
    level: "write",
    scope: "repository",
    requirement: "capability",
    purpose: "Include the readiness runner workflow file in that same reviewed setup pull request.",
    degradation: "The setup pull request omits the workflow file; copy it to .github/workflows/ yourself.",
  },
  {
    key: "issues",
    label: "Issues",
    level: "write",
    scope: "repository",
    requirement: "capability",
    purpose: "Reply to /boardreadyops slash commands on pull request conversations.",
    degradation: "Slash commands are unavailable; use the dashboard action buttons instead.",
  },
];

/** Permission keys the profile declares, in profile order. */
export function declaredPermissionKeys(): readonly string[] {
  return githubAppPermissionProfile.map((entry) => entry.key);
}

/**
 * The declared profile as GitHub's own `permissions` shape.
 *
 * Used by the setup API response and by the tests that assert the documented profile and the
 * evaluated capabilities agree.
 */
export function declaredPermissionRecord(): Record<string, GitHubAppPermissionLevel> {
  const record: Record<string, GitHubAppPermissionLevel> = {};
  for (const entry of githubAppPermissionProfile) record[entry.key] = entry.level;
  return record;
}

function permissionSatisfied(capabilities: GitHubAppCapabilities, entry: GitHubAppPermissionDeclaration): boolean {
  const write = entry.level === "write";
  switch (entry.key) {
    case "metadata":
      return capabilities.metadataRead;
    case "checks":
      return write ? capabilities.checksWrite : capabilities.checksRead;
    case "actions":
      return write ? capabilities.actionsDispatch : capabilities.actionsRead;
    case "pull_requests":
      return write ? capabilities.pullRequestsWrite : capabilities.pullRequestsRead;
    case "contents":
      return write ? capabilities.contentsWrite : capabilities.contentsRead;
    case "workflows":
      return write ? capabilities.workflowsWrite : capabilities.workflowsRead;
    case "issues":
      return write ? capabilities.issuesWrite : capabilities.issuesRead;
    default:
      return false;
  }
}

/**
 * The declared permissions an installation has not granted at the declared level.
 *
 * Driven by the live `permissions` object GitHub returns when an installation token is minted,
 * so a page can explain exactly which grant is missing rather than guessing from a failed call.
 */
export function missingDeclaredPermissions(
  permissions: GitHubAppPermissions | Record<string, string | undefined> = {},
): readonly GitHubAppPermissionDeclaration[] {
  const capabilities = evaluateAppCapabilities(permissions);
  return githubAppPermissionProfile.filter((entry) => !permissionSatisfied(capabilities, entry));
}

/**
 * The product actions a surface can offer, and what each one needs.
 *
 * `requirement` reuses the capability vocabulary `checkCapabilityRequirement` already validates,
 * so a button's enablement and the server's refusal reason can never disagree.
 */
export type GitHubAppActionId = "fix" | "release-preview" | "rerun" | "setup" | "waive";

export type GitHubAppAction = {
  id: GitHubAppActionId;
  label: string;
  description: string;
  requirement: CapabilityRequirement;
};

export const githubAppActions: readonly GitHubAppAction[] = [
  {
    id: "rerun",
    label: "Re-run readiness",
    description: "Dispatch a fresh readiness run against the current head commit.",
    requirement: "dispatch_analysis",
  },
  {
    id: "release-preview",
    label: "Preview release",
    description: "Build the release checklist and manufacturing package draft without publishing a tag.",
    requirement: "dispatch_analysis",
  },
  {
    id: "setup",
    label: "Open setup pull request",
    description: "Commit boardreadyops.yml and the readiness workflow to a reviewed branch.",
    requirement: "setup_pr",
  },
  {
    id: "waive",
    label: "Propose waiver",
    description: "Record an audited policy waiver for a rule as a reviewed pull request.",
    requirement: "waiver_pr",
  },
  {
    id: "fix",
    label: "Open remediation pull request",
    description: "Apply the suggested configuration fix on a reviewed branch.",
    requirement: "remediation_pr",
  },
];

export type GitHubAppActionAvailability = CapabilityCheckResult & GitHubAppAction;

/** Which declared actions the given permissions allow, carrying the reason for each refusal. */
export function evaluateActionAvailability(
  permissions: GitHubAppPermissions | Record<string, string | undefined> = {},
): readonly GitHubAppActionAvailability[] {
  const capabilities = evaluateAppCapabilities(permissions);
  return githubAppActions.map((action) => ({
    ...action,
    ...checkCapabilityRequirement(capabilities, action.requirement),
  }));
}
