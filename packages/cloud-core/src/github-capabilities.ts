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
