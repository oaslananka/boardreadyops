import type { NotificationEvent } from "@boardreadyops/cloud-core/notifications";

/**
 * Turns a terminal release-run result into the notification a team should receive.
 *
 * Pure and separate from the result route so the wording and the "is this worth interrupting
 * someone for" decision are testable without a database, a runner, or a GitHub App.
 *
 * Only two of the catalogue's events come from here: a board that became blocked, and a board
 * that became ready. Everything else a run produces is detail someone can look up, and a channel
 * that fires on detail is a channel that gets muted.
 */

export type RunOutcomeInput = {
  runId: string;
  installationId: string;
  repositoryFullName: string;
  /** Present when the run was attached to a pull request. */
  pullRequestNumber?: number | undefined;
  commitSha?: string | undefined;
  /** The run's decision, as persisted: `pass`, `fail`, `error`, … */
  decision: string | undefined;
  status: string;
  findings: readonly { severity: string; ruleId?: string | undefined }[];
  /** Absolute link to the run, as published on the Check Run. Without it the message carries no URL. */
  runUrl?: string | undefined;
  occurredAt: string;
};

const blockingSeverities = new Set(["critical", "error", "high"]);

/** Blocking findings grouped by rule, the worst offender first. */
function blockingBreakdown(findings: readonly { severity: string; ruleId?: string | undefined }[]): {
  total: number;
  lines: string[];
} {
  const byRule = new Map<string, number>();
  let total = 0;
  for (const finding of findings) {
    if (!blockingSeverities.has(finding.severity.toLowerCase())) continue;
    total += 1;
    const rule = finding.ruleId?.trim() || "unattributed";
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  }
  const lines = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([rule, count]) => `${rule} — ${count} blocking finding${count === 1 ? "" : "s"}`);
  return { total, lines };
}

function shortSha(value: string | undefined): string | undefined {
  return value && value.length >= 7 ? value.slice(0, 7) : value;
}

function whereLine(input: RunOutcomeInput): string {
  const sha = shortSha(input.commitSha);
  if (input.pullRequestNumber !== undefined) {
    return sha ? `Pull request #${input.pullRequestNumber}, commit ${sha}` : `Pull request #${input.pullRequestNumber}`;
  }
  return sha ? `Commit ${sha}` : "Latest commit";
}

export function runOutcomeEvent(input: RunOutcomeInput): NotificationEvent | undefined {
  // Only a finished run is news. An in-flight or superseded one has nothing to tell anyone yet.
  if (input.status !== "completed") return undefined;

  const decision = input.decision?.toLowerCase();
  const blocking = blockingBreakdown(input.findings);
  const url = input.runUrl;

  if (decision === "fail" || decision === "error") {
    const total = blocking.total;
    return {
      type: "release.blocked",
      installationId: input.installationId,
      repositoryFullName: input.repositoryFullName,
      headline:
        decision === "error"
          ? "The readiness check could not complete, so this board is not cleared to fabricate"
          : total === 1
            ? "1 blocking finding stops this board from being fabricated"
            : `${total} blocking findings stop this board from being fabricated`,
      details: [whereLine(input), ...blocking.lines],
      ...(url ? { url } : {}),
      // Keyed on the run, so a replayed result announces nothing and a genuine re-run does.
      dedupeKey: `run:${input.runId}:blocked`,
      occurredAt: input.occurredAt,
    };
  }

  if (decision === "pass") {
    return {
      type: "release.ready",
      installationId: input.installationId,
      repositoryFullName: input.repositoryFullName,
      headline: "This board passed every gate and is ready to fabricate",
      details: [whereLine(input), "Evidence was sealed; the release decision is recorded against this commit."],
      ...(url ? { url } : {}),
      dedupeKey: `run:${input.runId}:ready`,
      occurredAt: input.occurredAt,
    };
  }

  // A decision nobody declared — `not_available`, a future value — is not worth a message. The
  // run is still in the dashboard and the Check Run is still authoritative.
  return undefined;
}
