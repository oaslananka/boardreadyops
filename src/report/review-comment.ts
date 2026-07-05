import type { BomRiskSummary } from "../core/bom-risk.js";
import type { ReleaseMode } from "../core/config.types.js";
import type { Finding, Severity } from "../core/findings.js";
import type { RunResult } from "../core/result.js";
import { type Locale, t } from "../i18n/t.js";
import { stickyMarker } from "./markdown.js";

export interface ReviewReportLink {
  label: string;
  url: string;
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const TOP_PER_SEVERITY = 3;

/**
 * Render a compact, app-style release-review comment: a single decision line, a severity
 * breakdown, the top findings grouped by severity, report links, and install guidance.
 * Shares the sticky marker with the full Markdown report so the Action upserts one comment.
 */
export function formatReviewComment(
  result: RunResult,
  reports: ReviewReportLink[] = [],
  locale: Locale = "en",
): string {
  const lines: string[] = [stickyMarker, "", "## BoardReadyOps release review", "", decisionLine(result), ""];
  lines.push(...severityTable(result, locale), "");
  lines.push(...topFindings(result, locale));
  if (result.bomRisk && result.bomRisk.overallRiskScore > 0) {
    lines.push("", ...bomRiskSection(result.bomRisk));
  }
  if (reports.length > 0) {
    lines.push("", "### Reports", ...reports.map((report) => `- [${report.label}](${report.url})`));
  }
  lines.push(
    "",
    "---",
    "Add the BoardReadyOps GitHub Action to post this review on every pull request — see the review app guide for the prototype workflow.",
  );
  return `${lines.join("\n")}\n`;
}

function reviewDecisionFailed(result: RunResult): boolean {
  return result.summary.failed || (result.policy?.enforced === true && result.policy.status === "fail");
}

function decisionLine(result: RunResult): string {
  const failed = reviewDecisionFailed(result);
  const parts: string[] = [
    result.summary.total > 0
      ? `${result.summary.total} finding(s), max severity ${result.summary.maxSeverity}`
      : "no findings",
  ];
  if (result.readiness) {
    parts.push(`readiness ${result.readiness.score}/100 (${result.readiness.status})`);
  }
  if (result.policy?.enforced) {
    parts.push(`policy ${result.policy.status}`);
  }
  const modeBadge = result.releaseMode ? `${releaseModeEmoji(result.releaseMode)} ${result.releaseMode} | ` : "";
  return `**Decision: ${failed ? "❌ FAIL" : "✅ PASS"}** — ${modeBadge}${parts.join("; ")}`;
}

const RELEASE_MODE_EMOJI: Record<ReleaseMode, string> = {
  prototype: "🔬",
  pilot: "🧪",
  production: "🏭",
};

function releaseModeEmoji(mode: ReleaseMode): string {
  return RELEASE_MODE_EMOJI[mode];
}

function severityTable(result: RunResult, locale: Locale): string[] {
  const rows: string[] = ["| Severity | Count |", "| --- | ---: |"];
  for (const severity of SEVERITY_ORDER) {
    const count = result.summary[severity];
    if (severity === "info" && count === 0) {
      continue;
    }
    rows.push(`| ${severityLabel(severity, locale)} | ${count} |`);
  }
  return rows;
}

function topFindings(result: RunResult, locale: Locale): string[] {
  if (result.findings.length === 0) {
    return ["No blocking findings — this board is ready for the next release step."];
  }
  const lines: string[] = ["### Top findings"];
  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) {
      continue;
    }
    lines.push("", `**${severityLabel(severity, locale)}** (${group.length})`);
    for (const finding of group.slice(0, TOP_PER_SEVERITY)) {
      lines.push(`- \`${finding.ruleId}\` — ${finding.message} (${location(finding)})`);
    }
    if (group.length > TOP_PER_SEVERITY) {
      lines.push(`- …and ${group.length - TOP_PER_SEVERITY} more.`);
    }
  }
  return lines;
}

function location(finding: Finding): string {
  const line = finding.location?.line ? `:${finding.location.line}` : "";
  return `\`${finding.resource.path}${line}\``;
}

function severityLabel(severity: Severity, locale: Locale): string {
  return t(`severity.${severity}`, {}, locale);
}

function bomRiskSection(risk: BomRiskSummary): string[] {
  const atRisk = risk.components.filter((c) => c.riskLevel !== "none");
  const lines: string[] = [
    "### BOM Supply-Chain Risk",
    "",
    `Overall risk score: **${risk.overallRiskScore}/100** (${risk.overallRiskLevel}) — ` +
      `${risk.totalComponents} component(s) evaluated, ${atRisk.length} at risk.`,
  ];
  if (atRisk.length > 0) {
    lines.push("", "| Component | Score | Level | Factors |", "| --- | ---: | --- | --- |");
    for (const c of atRisk) {
      const parts: string[] = [];
      if (c.factors.missingMpn) parts.push("no MPN");
      if (c.factors.missingManufacturer) parts.push("no manufacturer");
      if (c.factors.noSuppliers) parts.push("no suppliers");
      else if (c.factors.singleSourceNoAlternates) parts.push("single source");
      lines.push(`| \`${c.reference}\` | ${c.riskScore} | ${c.riskLevel} | ${parts.join(", ") || "—"} |`);
    }
  }
  return lines;
}
