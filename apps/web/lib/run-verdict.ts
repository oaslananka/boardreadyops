/**
 * The one thing a person came to this page to find out.
 *
 * Somebody opens a run because they are about to spend real money and weeks of lead time on a
 * fabrication order, and they want to know whether they can. The page used to answer that with
 * three adjacent enum badges — status, decision, conclusion — which are internal vocabulary
 * that nobody thinks in, and copy like "the normalized result is ready for evidence review".
 *
 * This produces the answer instead: a verdict short enough to read across a desk, one sentence
 * that names the actual reason rather than counting rows, and the single next thing to do.
 */

type VerdictTone = "success" | "danger" | "warning" | "info";

export type RunVerdict = {
  tone: VerdictTone;
  /** Two to four words. This is the sentence somebody reads first and possibly only. */
  headline: string;
  /** One plain sentence. Names the blocking thing; never just a count. */
  detail: string;
  action: { label: string; href: string } | undefined;
};

type VerdictFinding = {
  severity: string;
  message: string;
  waivedAt: string | undefined;
};

export type VerdictRun = {
  id: string;
  status: string;
  decision: string | undefined;
  conclusion: string | undefined;
  commitSha: string;
  investigationState: string;
  findings: readonly VerdictFinding[];
};

const blockingSeverities = new Set(["critical", "error", "high"]);
/** Lands on the findings already filtered to what is open and sorted worst-first. */
const blockingFindingsQuery = "?findingState=active&findingSort=severity";
const settlingStates = new Set(["queued", "dispatched", "running"]);

function shortSha(commitSha: string): string {
  return commitSha.slice(0, 7) || "this commit";
}

/**
 * Trims a rule message down to something that reads as a sentence in a headline block.
 *
 * Rule messages are written for a findings table and sometimes carry a trailing location or a
 * full stop. Neither belongs in a one-line answer.
 */
function asReason(message: string): string {
  let trimmed = message.trim().replace(/\s+/gu, " ");
  while (trimmed.endsWith(".") || trimmed.endsWith(" ")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.length === 0) return "";
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function buildPassDetail(commitSha: string, blockingCount: number, advisoryCount: number): string {
  if (blockingCount > 0) {
    return `Within your policy, but ${blockingCount} high-severity ${plural(blockingCount, "finding is", "findings are")} recorded.`;
  }
  if (advisoryCount > 0) {
    return `Nothing is blocking. ${advisoryCount} ${plural(advisoryCount, "thing", "things")} worth a look before you order.`;
  }
  return `Every check passed on ${shortSha(commitSha)}.`;
}

function handleSettlingRun(run: VerdictRun): RunVerdict {
  return {
    tone: "info",
    headline: "Still checking",
    detail: `Running the checks on ${shortSha(run.commitSha)}. This page updates itself as they finish.`,
    action: { label: "Follow the execution", href: `/runs/${run.id}/attempts` },
  };
}

function handleMissingDecisionRun(run: VerdictRun): RunVerdict {
  return {
    tone: "danger",
    headline: "Could not check this board",
    detail:
      run.status === "timed_out"
        ? "The run ran out of time before it produced a result, so nothing has been checked yet."
        : "The run ended without producing a result, so nothing has been checked yet.",
    action: { label: "See what happened", href: `/runs/${run.id}/attempts` },
  };
}

function handleFailedRun(
  run: VerdictRun,
  active: readonly VerdictFinding[],
  blocking: readonly VerdictFinding[],
): RunVerdict {
  const first = asReason(blocking[0]?.message ?? active[0]?.message ?? "");
  const others = Math.max(0, blocking.length - 1);
  const rest = others > 0 ? ` Plus ${others} other blocking ${plural(others, "issue", "issues")}.` : "";
  return {
    tone: "danger",
    headline: "Not ready to fabricate",
    detail: first ? `${first}.${rest}` : "The policy for this repository rejected the result.",
    action: { label: "See what is blocking", href: `/runs/${run.id}/findings${blockingFindingsQuery}` },
  };
}

function handlePassedRun(run: VerdictRun, blocking: readonly VerdictFinding[], advisory: number): RunVerdict {
  const detail = buildPassDetail(run.commitSha, blocking.length, advisory);
  const outstanding = blocking.length + advisory;
  return {
    tone: "success",
    headline: "Ready to fabricate",
    detail,
    action:
      outstanding > 0
        ? {
            label: `Review ${outstanding} ${plural(outstanding, "finding", "findings")}`,
            href: `/runs/${run.id}/findings${blockingFindingsQuery}`,
          }
        : { label: "See the evidence", href: `/runs/${run.id}/artifacts` },
  };
}

export function runVerdict(run: VerdictRun): RunVerdict {
  const active = run.findings.filter((finding) => !finding.waivedAt);
  const blocking = active.filter((finding) => blockingSeverities.has(finding.severity.toLowerCase()));
  const advisory = active.length - blocking.length;

  if (settlingStates.has(run.status) || run.investigationState === "current") {
    return handleSettlingRun(run);
  }

  if (run.decision === undefined && (run.status === "failed" || run.status === "timed_out")) {
    return handleMissingDecisionRun(run);
  }

  if (run.decision === "fail" || run.conclusion === "failure") {
    return handleFailedRun(run, active, blocking);
  }

  if (run.decision === "pass" || run.conclusion === "success") {
    return handlePassedRun(run, blocking, advisory);
  }

  return {
    tone: "warning",
    headline: "Needs a look",
    detail:
      active.length > 0
        ? `No clear pass, and ${active.length} ${plural(active.length, "finding", "findings")} ${plural(active.length, "needs", "need")} a decision before release.`
        : "The checks finished without a clear pass. Read the evidence before releasing.",
    action: { label: "Open the findings", href: `/runs/${run.id}/findings` },
  };
}
