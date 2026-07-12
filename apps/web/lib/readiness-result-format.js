const severityOrder = ["error", "high", "medium", "low", "info"];
const severityLabels = {
  error: "Error",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

function statusLabel(status) {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    default:
      return sanitizeInline(status);
  }
}

function decisionLabel(decision) {
  switch (decision) {
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
    case "error":
      return "Error";
    case null:
    case undefined:
      return "None";
    default:
      return sanitizeInline(decision);
  }
}

function decisionEmoji(decision, status) {
  if (status === "timed_out") {
    return "⏱️";
  }

  if (decision === "pass") {
    return "✅";
  }

  if (decision === "fail" || decision === "error" || status === "failed") {
    return "❌";
  }

  return "ℹ️";
}

function severityCounts(findings) {
  const counts = new Map(severityOrder.map((severity) => [severity, 0]));

  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  return counts;
}

function severitySummary(findings) {
  if (findings.length === 0) {
    return "No findings reported.";
  }

  const counts = severityCounts(findings);
  const parts = severityOrder.flatMap((severity) => {
    const count = counts.get(severity) ?? 0;
    return count > 0 ? [`${severityLabels[severity] ?? severity}: ${count}`] : [];
  });

  return parts.join(" · ");
}

function topFindings(findings, limit = 5) {
  const severityRank = new Map(severityOrder.map((severity, index) => [severity, index]));
  return [...findings]
    .sort((a, b) => {
      const rank = (severityRank.get(a.severity) ?? 99) - (severityRank.get(b.severity) ?? 99);
      return rank === 0 ? a.ruleId.localeCompare(b.ruleId) : rank;
    })
    .slice(0, limit);
}

function metricEntries(metrics, limit = 8) {
  return Object.entries(metrics ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limit);
}

function detailsLine(detailsUrl) {
  return detailsUrl ? `\n\nOpen the hosted run dashboard: ${detailsUrl}` : "";
}

function sanitizeInline(value) {
  return String(value)
    .replace(/[\r\n|]/g, " ")
    .trim();
}

function code(value) {
  return `\`${String(value)
    .replace(/`/g, "'")
    .replace(/[\r\n]/g, " ")
    .trim()}\``;
}

function findingLine(finding) {
  const location = finding.path ? ` (${code(finding.path)})` : "";
  return `- **${sanitizeInline(finding.severity)}** ${code(finding.ruleId)}${location}: ${sanitizeInline(finding.message)}`;
}

function markdownLinkLabel(value) {
  let escaped = "";
  for (const character of sanitizeInline(value)) {
    if (character === "\\" || character === "[" || character === "]") {
      escaped += "\\";
    }
    escaped += character;
  }
  return escaped;
}

function markdownLinkUrl(value) {
  return encodeURI(String(value)).replaceAll("(", "%28").replaceAll(")", "%29");
}

function reportLinkLine(link) {
  return `- [${markdownLinkLabel(link.label)}](${markdownLinkUrl(link.url)})`;
}

export function buildReadinessCheckOutput(input) {
  const findings = input.findings ?? [];
  const artifacts = input.artifacts ?? [];
  const reports = input.reportLinks ?? [];
  const metrics = input.metrics ?? {};
  const title = `${decisionEmoji(input.decision, input.status)} BoardReadyOps release readiness: ${decisionLabel(input.decision)}`;
  const lines = [
    `**Status:** ${statusLabel(input.status)}`,
    `**Decision:** ${decisionLabel(input.decision)}`,
    `**Findings:** ${findings.length}`,
    `**Artifacts:** ${artifacts.length}`,
    `**Reports:** ${reports.length}`,
    `**Severity summary:** ${severitySummary(findings)}`,
  ];

  const visibleMetrics = metricEntries(metrics, 5);
  if (visibleMetrics.length > 0) {
    lines.push("", "### Metrics");
    for (const [name, value] of visibleMetrics) {
      lines.push(`- ${code(name)}: ${value}`);
    }
  }

  const visibleFindings = topFindings(findings);
  if (visibleFindings.length > 0) {
    lines.push("", "### Top findings");
    for (const finding of visibleFindings) {
      lines.push(findingLine(finding));
    }
  }

  if (findings.length > visibleFindings.length) {
    lines.push(`- …and ${findings.length - visibleFindings.length} more findings.`);
  }

  if (reports.length > 0) {
    lines.push("", "### Reports");
    for (const report of reports.slice(0, 10)) {
      lines.push(reportLinkLine(report));
    }
  }

  return {
    title,
    summary: `${lines.join("\n")}${detailsLine(input.detailsUrl)}`,
  };
}

export function buildReadinessPrComment(input) {
  const findings = input.findings ?? [];
  const artifacts = input.artifacts ?? [];
  const reports = input.reportLinks ?? [];
  const metrics = input.metrics ?? {};
  const lines = [
    `## ${decisionEmoji(input.decision, input.status)} BoardReadyOps release readiness`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Status | ${statusLabel(input.status)} |`,
    `| Decision | ${decisionLabel(input.decision)} |`,
    `| Findings | ${findings.length} |`,
    `| Artifacts | ${artifacts.length} |`,
    `| Reports | ${reports.length} |`,
    `| Severity summary | ${severitySummary(findings)} |`,
  ];

  const visibleMetrics = metricEntries(metrics);
  if (visibleMetrics.length > 0) {
    lines.push("", "### Metrics", "");
    for (const [name, value] of visibleMetrics) {
      lines.push(`- ${code(name)}: ${value}`);
    }
  }

  const visibleFindings = topFindings(findings, 10);
  if (visibleFindings.length > 0) {
    lines.push("", "### Highest-priority findings", "");
    for (const finding of visibleFindings) {
      lines.push(findingLine(finding));
    }
  }

  if (findings.length > visibleFindings.length) {
    lines.push(`- …and ${findings.length - visibleFindings.length} more findings.`);
  }

  if (reports.length > 0) {
    lines.push("", "### Reports", "");
    for (const report of reports) {
      lines.push(reportLinkLine(report));
    }
  }

  if (input.detailsUrl) {
    lines.push("", `[Open hosted run dashboard](${input.detailsUrl})`);
  }

  lines.push("", "<!-- boardreadyops:release-readiness -->");

  return lines.join("\n");
}
