import type {
  GitHubAppLifecycleAction,
  GitHubInstallationRef,
  GitHubRepositoryRef,
  PullRequestSafeMode,
} from "./lifecycle.js";

export type ParsedGitHubCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "rerun" }
  | { kind: "diff" }
  | { kind: "release-preview" }
  | { kind: "explain"; ruleId: string }
  | { kind: "setup" }
  | { kind: "waive"; ruleId: string; reason?: string }
  | { kind: "fix"; ruleId?: string };

export type CommandAuthorizationResult = {
  authorized: boolean;
  reason?: string;
};

export type CommandExecutionContext = {
  repository: GitHubRepositoryRef;
  installation: GitHubInstallationRef;
  pullRequestNumber: number;
  headCommitSha: string;
  headRef: string;
  baseCommitSha?: string;
  pullRequestDraft?: boolean;
  pullRequestFromFork?: boolean;
  safeMode?: PullRequestSafeMode;
  author?: string;
  checkRunId?: number;
};

export type CommandExecutionPlan =
  | { kind: "comment"; body: string }
  | { kind: "action"; action: GitHubAppLifecycleAction }
  | { kind: "actions"; actions: GitHubAppLifecycleAction[] };

const MUTATING_COMMANDS = new Set(["rerun", "setup", "waive", "fix", "release-preview"]);
const PRIVILEGED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const VALID_RULE_ID_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;

function parseWaiveCommand(tokens: readonly string[]): ParsedGitHubCommand | undefined {
  const ruleId = tokens[1];
  if (!ruleId || !VALID_RULE_ID_PATTERN.test(ruleId)) return undefined;

  let reason: string | undefined;
  for (const [index, token] of tokens.entries()) {
    if (index < 2) continue;
    const nextToken = tokens[index + 1];
    if (token === "--reason" && nextToken) {
      reason = sanitizeReason(nextToken);
      break;
    }
    if (token.startsWith("--reason=")) {
      reason = sanitizeReason(token.slice("--reason=".length));
      break;
    }
  }

  return reason ? { kind: "waive", ruleId, reason } : { kind: "waive", ruleId };
}

function parseFixCommand(tokens: readonly string[]): ParsedGitHubCommand | undefined {
  const ruleId = tokens[1];
  if (ruleId && !VALID_RULE_ID_PATTERN.test(ruleId)) return undefined;
  return ruleId ? { kind: "fix", ruleId } : { kind: "fix" };
}

function parseTokenizedCommand(tokens: readonly string[]): ParsedGitHubCommand | undefined {
  const sub = tokens[0]?.toLowerCase();
  if (!sub) return { kind: "help" };

  switch (sub) {
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status" };
    case "rerun":
      return { kind: "rerun" };
    case "diff":
      return { kind: "diff" };
    case "release-preview":
      return { kind: "release-preview" };
    case "setup":
      return { kind: "setup" };
    case "explain": {
      const ruleId = tokens[1];
      return ruleId && VALID_RULE_ID_PATTERN.test(ruleId) ? { kind: "explain", ruleId } : undefined;
    }
    case "waive":
      return parseWaiveCommand(tokens);
    case "fix":
      return parseFixCommand(tokens);
    default:
      return { kind: "help" };
  }
}

export function parseGitHubCommand(commentBody: string): ParsedGitHubCommand | undefined {
  if (!commentBody) return undefined;

  for (const rawLine of commentBody.split("\n")) {
    const rest = extractCommandArgs(rawLine.trim());
    if (rest === null) continue;
    return parseTokenizedCommand(tokenizeArgs(rest));
  }

  return undefined;
}

function sanitizeReason(raw: string): string {
  let cleaned = "";
  for (const char of raw) {
    if (cleaned.length >= 500) break;
    const code = char.codePointAt(0);
    if (code !== undefined && code >= 32 && code !== 127) {
      cleaned += char.slice(0, 500 - cleaned.length);
    }
  }
  return cleaned;
}

function firstMentionSeparatorIndex(text: string): number {
  const spaceIndex = text.indexOf(" ");
  const tabIndex = text.indexOf("\t");
  if (spaceIndex === -1) return tabIndex;
  if (tabIndex === -1) return spaceIndex;
  return Math.min(spaceIndex, tabIndex);
}

function extractCommandArgs(line: string): string | null {
  let text = line;
  if (text.startsWith("@")) {
    const splitIndex = firstMentionSeparatorIndex(text);
    if (splitIndex === -1) return null;

    const mention = text.slice(1, splitIndex);
    if (!/^[\w-]+$/.test(mention)) return null;
    text = text.slice(splitIndex).trimStart();
  }

  const normalized = text.toLowerCase();
  if (!normalized.startsWith("/boardreadyops") && !normalized.startsWith("!boardreadyops")) return null;

  const after = text.slice(14);
  if (after.length === 0) return "";
  if (!after.startsWith(" ") && !after.startsWith("\t")) return null;
  return after.trim();
}

function tokenizeArgs(str: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes: "'" | '"' | null = null;

  for (const char of str) {
    if (inQuotes) {
      if (char === inQuotes) inQuotes = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      inQuotes = char;
      continue;
    }

    if (!/\s/.test(char)) {
      current += char;
      continue;
    }

    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function evaluateCommandAuthorization(
  command: ParsedGitHubCommand,
  authorAssociation: string,
): CommandAuthorizationResult {
  if (!MUTATING_COMMANDS.has(command.kind)) {
    return { authorized: true };
  }

  const normalizedAssoc = authorAssociation.toUpperCase();
  if (PRIVILEGED_ASSOCIATIONS.has(normalizedAssoc)) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: `Command \`/boardreadyops ${command.kind}\` requires write permissions (OWNER, MEMBER, or COLLABORATOR) on this repository.`,
  };
}

const EXPLANATIONS: Record<string, { title: string; summary: string; remedy: string }> = {
  "bom.missing-mpn": {
    title: "Missing Manufacturer Part Number (MPN)",
    summary:
      "One or more BOM entries lack a valid Manufacturer Part Number (MPN). Sourcing and assembly cannot locate or procure the component.",
    remedy:
      "Add the `MPN` field to the component properties in KiCad Schematic Editor (`E`), or update the BOM CSV with exact manufacturer part numbers.",
  },
  "drc.clearance": {
    title: "DRC Clearance Violation",
    summary: "Trace-to-trace, trace-to-pad, or pad-to-pad spacing is smaller than the minimum board fabrication rules.",
    remedy:
      "Reroute the violating traces in KiCad PCB Editor or adjust track clearances to meet the board fabricator's design rules.",
  },
  "pinmap.unconnected-power": {
    title: "Unconnected Power Pin",
    summary: "A component power pin (VCC, VDD, GND) is not connected to any net or power rail.",
    remedy: "Connect the power pin to the intended power net or place a No-Connect symbol if intentionally unpowered.",
  },
};

function rerunCommandPlan(context: CommandExecutionContext): CommandExecutionPlan {
  const enqueueAction: GitHubAppLifecycleAction = {
    type: "release_run.enqueue",
    installation: context.installation,
    repository: context.repository,
    pullRequestNumber: context.pullRequestNumber,
    ref: context.headRef,
    commitSha: context.headCommitSha,
    triggerKind: "pr",
  };
  if (context.baseCommitSha) enqueueAction.baseCommitSha = context.baseCommitSha;
  if (context.pullRequestDraft !== undefined) enqueueAction.pullRequestDraft = context.pullRequestDraft;
  if (context.pullRequestFromFork !== undefined) enqueueAction.pullRequestFromFork = context.pullRequestFromFork;
  if (context.safeMode) enqueueAction.safeMode = context.safeMode;
  return { kind: "action", action: enqueueAction };
}

function releasePrepareCommandPlan(context: CommandExecutionContext): CommandExecutionPlan {
  const action: GitHubAppLifecycleAction = {
    type: "release.prepare",
    installation: context.installation,
    repository: context.repository,
    pullRequestNumber: context.pullRequestNumber,
    ref: context.headRef,
    commitSha: context.headCommitSha,
  };
  if (context.baseCommitSha) action.baseCommitSha = context.baseCommitSha;
  if (context.pullRequestDraft !== undefined) action.pullRequestDraft = context.pullRequestDraft;
  if (context.pullRequestFromFork !== undefined) action.pullRequestFromFork = context.pullRequestFromFork;
  if (context.safeMode) action.safeMode = context.safeMode;
  if (context.author) action.requestedBy = context.author;
  if (context.checkRunId) action.checkRunId = context.checkRunId;
  return { kind: "action", action };
}

function setupCommandPlan(context: CommandExecutionContext): CommandExecutionPlan {
  const setupAction: GitHubAppLifecycleAction = {
    type: "setup_pr.create",
    installation: context.installation,
    repository: context.repository,
  };
  if (context.checkRunId) setupAction.checkRunId = context.checkRunId;
  if (context.author) setupAction.requestedBy = context.author;
  return { kind: "action", action: setupAction };
}

function waiverCommandPlan(
  command: Extract<ParsedGitHubCommand, { kind: "waive" }>,
  context: CommandExecutionContext,
): CommandExecutionPlan {
  const waiverAction: GitHubAppLifecycleAction = {
    type: "waiver_pr.request",
    installation: context.installation,
    repository: context.repository,
    ruleId: command.ruleId,
  };
  if (command.reason) waiverAction.reason = command.reason;
  if (context.checkRunId) waiverAction.checkRunId = context.checkRunId;
  if (context.author) waiverAction.requestedBy = context.author;
  return { kind: "action", action: waiverAction };
}

function explainCommandPlan(command: Extract<ParsedGitHubCommand, { kind: "explain" }>): CommandExecutionPlan {
  const info = EXPLANATIONS[command.ruleId];
  if (info) {
    return {
      kind: "comment",
      body: `### Rule Explanation: \`${command.ruleId}\` — ${info.title}

${info.summary}

**Recommended Action:**
${info.remedy}
`,
    };
  }
  return {
    kind: "comment",
    body: `### Rule Explanation: \`${command.ruleId}\`

Finding \`${command.ruleId}\` was reported by BoardReadyOps release checks.
Review the design in KiCad, inspect the annotated files in the Check Run or Files Changed tab, or run \`/boardreadyops status\` for details.
`,
  };
}

export function executeParsedCommand(
  command: ParsedGitHubCommand,
  context: CommandExecutionContext,
): CommandExecutionPlan {
  switch (command.kind) {
    case "help": {
      return {
        kind: "comment",
        body: `### BoardReadyOps Slash Commands

| Command | Description | Permission |
| :--- | :--- | :--- |
| \`/boardreadyops status\` | View current hardware release readiness verdict and summary | All |
| \`/boardreadyops rerun\` | Re-trigger fresh release readiness check on head commit | Write |
| \`/boardreadyops explain <rule-id>\` | Explain rule failure and how to fix it in KiCad | All |
| \`/boardreadyops diff\` | Hardware impact summary (layers, netlist, BOM items) | All |
| \`/boardreadyops release-preview\` | Hardware release checklist and manufacturing package draft | All |
| \`/boardreadyops setup\` | Open automated pull request to configure BoardReadyOps | Write |
| \`/boardreadyops waive <rule-id> --reason "<text>"\` | Propose an audited policy waiver PR | Write |
| \`/boardreadyops fix [rule-id]\` | Get auto-fix guidance or open remediation PR | Write |
| \`/boardreadyops help\` | Show this help menu | All |
`,
      };
    }

    case "status": {
      return {
        kind: "comment",
        body: `### BoardReadyOps Readiness Status

- **Repository:** \`${context.repository.fullName}\`
- **Head Ref:** \`${context.headRef}\` (\`${context.headCommitSha.slice(0, 7)}\`)
- **PR:** #${context.pullRequestNumber}

> Run \`/boardreadyops rerun\` to trigger a fresh evaluation, or \`/boardreadyops help\` for more options.
`,
      };
    }

    case "rerun":
      return rerunCommandPlan(context);

    case "setup":
      return setupCommandPlan(context);

    case "waive":
      return waiverCommandPlan(command, context);

    case "explain":
      return explainCommandPlan(command);

    case "diff": {
      return {
        kind: "comment",
        body: `### Hardware Impact Diff (PR #${context.pullRequestNumber})

Evaluating schematic, netlist, PCB layer stack, and BOM deltas against base commit...
- Review annotations on the PR diff tab for specific component and pin changes.
- Check fabrication rule constraints before merging to \`${context.repository.defaultBranch ?? "main"}\`.
`,
      };
    }

    case "release-preview":
      return releasePrepareCommandPlan(context);

    case "fix": {
      return {
        kind: "comment",
        body: `### BoardReadyOps Remediation Guide

For finding \`${command.ruleId ?? "all"}\`:
1. Open the design in KiCad Schematic/PCB Editor.
2. Address the reported issues indicated in the GitHub annotations on the **Files changed** tab.
3. Commit and push the changes directly to \`${context.headRef}\`.
4. BoardReadyOps will automatically re-evaluate release readiness.
`,
      };
    }
  }
}
