const severityOrder = ["error", "high", "medium", "low", "info"];
const severityLabels = {
  error: "Error",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const safeModeReasonLabels = {
  "draft-pull-request": "Draft pull request",
  "fork-pull-request": "Fork pull request",
  "private-repository": "Private repository",
};

const terminalPresentations = {
  success: { emoji: "✅", label: "Ready to release" },
  warning: { emoji: "⚠️", label: "Review warnings" },
  failure: { emoji: "❌", label: "Release blocked" },
  cancelled: { emoji: "⏹️", label: "Run cancelled" },
  timedOut: { emoji: "⏱️", label: "Run timed out" },
  superseded: { emoji: "🔄", label: "Run superseded" },
};

function statusLabel(status) {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    case "superseded":
      return "Superseded";
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

function readinessStatusLabel(status) {
  switch (status) {
    case "ready":
      return "Ready";
    case "at-risk":
      return "At risk";
    case "blocked":
      return "Blocked";
    default:
      return sanitizeInline(status);
  }
}

function severityCounts(findings) {
  const counts = new Map(severityOrder.map((severity) => [severity, 0]));
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  return counts;
}

function severitySummary(findings) {
  if (findings.length === 0) return "No findings reported.";
  const counts = severityCounts(findings);
  return severityOrder
    .flatMap((severity) => {
      const count = counts.get(severity) ?? 0;
      return count > 0 ? [`${severityLabels[severity] ?? severity}: ${count}`] : [];
    })
    .join(" · ");
}

function sortedFindings(findings) {
  const severityRank = new Map(severityOrder.map((severity, index) => [severity, index]));
  return [...findings].sort((left, right) => {
    const rank = (severityRank.get(left.severity) ?? 99) - (severityRank.get(right.severity) ?? 99);
    return rank === 0 ? left.ruleId.localeCompare(right.ruleId) : rank;
  });
}

function splitFindings(input) {
  const findings = sortedFindings(input.findings ?? []);
  const blockers = findings.filter((finding) => finding.severity === "error" || finding.severity === "high");
  if (blockers.length === 0 && failureLike(input)) {
    return { blockers: findings, warnings: [] };
  }
  const blockerSet = new Set(blockers);
  return { blockers, warnings: findings.filter((finding) => !blockerSet.has(finding)) };
}

function activeWaivers(input) {
  return input.waivers?.active ?? [];
}

function expiredWaivers(input) {
  return input.waivers?.expired ?? [];
}

function warningLike(input) {
  const findings = input.findings ?? [];
  return (
    input.readiness?.status === "at-risk" ||
    (input.readiness?.warnings?.length ?? 0) > 0 ||
    findings.some(
      (finding) => finding.severity === "medium" || finding.severity === "low" || finding.severity === "info",
    ) ||
    activeWaivers(input).length > 0 ||
    expiredWaivers(input).length > 0
  );
}

function failureLike(input) {
  return (
    input.status === "failed" ||
    input.decision === "fail" ||
    input.decision === "error" ||
    input.readiness?.status === "blocked"
  );
}

function terminalOutcome(input) {
  if (input.status === "superseded") return "superseded";
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "timed_out") return "timedOut";
  if (failureLike(input)) return "failure";
  if (warningLike(input)) return "warning";
  return "success";
}

function presentation(input) {
  return terminalPresentations[terminalOutcome(input)];
}

function metricEntries(metrics, limit = 8) {
  return Object.entries(metrics ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limit);
}

function durationMetric(metrics) {
  const value = metrics?.durationMs ?? metrics?.duration_ms;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function sanitizeInline(value) {
  return String(value)
    .replace(/[\r\n|]/g, " ")
    .trim();
}

function code(value) {
  return `\`${String(value)
    .replaceAll("`", "'")
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
    if (character === "\\" || character === "[" || character === "]") escaped += "\\";
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

function readinessValue(readiness) {
  return readiness ? `${readiness.score}/100 · ${readinessStatusLabel(readiness.status)}` : "Not reported";
}

function findingsValue(input) {
  const { blockers, warnings } = splitFindings(input);
  return `${blockers.length} blocking · ${warnings.length} warning · ${(input.findings ?? []).length} total`;
}

function waiverValue(input) {
  return `${activeWaivers(input).length} active · ${expiredWaivers(input).length} expired`;
}

function trustModeValue(input) {
  if (input.trustMode === "safe") return "Safe (restricted)";
  if (input.trustMode === "standard") return "Standard";
  return undefined;
}

function trustReasonsValue(input) {
  const reasons = (input.safeModeReasons ?? [])
    .map((reason) => {
      const label = safeModeReasonLabels[reason];
      return typeof label === "string" ? `${label} (${code(reason)})` : undefined;
    })
    .filter((reason) => typeof reason === "string");
  return reasons.length > 0 ? reasons.join(" · ") : "None";
}

function appliedRestrictionsValue(input) {
  return input.trustMode === "safe" ? "Managed evidence artifacts unavailable for this safe-mode execution" : "None";
}

function appendTrustSummary(lines, input, style) {
  const trustMode = trustModeValue(input);
  if (!trustMode) return;
  if (style === "table") {
    lines.push(
      `| Trust mode | ${trustMode} |`,
      `| Trust reasons | ${trustReasonsValue(input)} |`,
      `| Applied restrictions | ${appliedRestrictionsValue(input)} |`,
    );
    return;
  }
  lines.push(
    `**Trust mode:** ${trustMode}`,
    `**Trust reasons:** ${trustReasonsValue(input)}`,
    `**Applied restrictions:** ${appliedRestrictionsValue(input)}`,
  );
}

function summaryTable(input) {
  const outcome = presentation(input);
  const duration = durationMetric(input.metrics);
  const lines = [
    "| Field | Value |",
    "| --- | --- |",
    `| Outcome | ${outcome.emoji} ${outcome.label} |`,
    `| Status | ${statusLabel(input.status)} |`,
    `| Decision | ${decisionLabel(input.decision)} |`,
  ];
  appendTrustSummary(lines, input, "table");
  lines.push(
    `| Readiness | ${readinessValue(input.readiness)} |`,
    `| Findings | ${findingsValue(input)} |`,
    `| Waivers | ${waiverValue(input)} |`,
    `| Artifacts | ${(input.artifacts ?? []).length} |`,
    `| Duration | ${duration === undefined ? "Not reported" : formatDuration(duration)} |`,
  );
  return lines;
}

function appendFindingSections(lines, input, limit) {
  const { blockers, warnings } = splitFindings(input);
  appendFindingSection(lines, "Blocking findings", blockers, limit);
  appendFindingSection(lines, "Warnings", warnings, limit);
}

function appendFindingSection(lines, title, findings, limit) {
  if (findings.length === 0) return;
  lines.push("", `### ${title}`, "");
  for (const finding of findings.slice(0, limit)) lines.push(findingLine(finding));
  if (findings.length > limit) lines.push(`- …and ${findings.length - limit} more findings.`);
}

function appendReadinessNotes(lines, readiness) {
  if (!readiness || readiness.warnings.length === 0) return;
  lines.push("", "### Readiness notes", "");
  for (const warning of readiness.warnings.slice(0, 10)) lines.push(`- ${sanitizeInline(warning)}`);
}

function waiverLine(waiver) {
  const expiry = waiver.expires ? ` · expires ${code(waiver.expires)}` : "";
  const state = waiver.stale ? " · stale" : "";
  return `- ${code(waiver.rule)} · ${sanitizeInline(waiver.owner)} · matched ${waiver.matched}${expiry}${state}: ${sanitizeInline(waiver.reason)}`;
}

function appendWaivers(lines, input) {
  const active = activeWaivers(input);
  const expired = expiredWaivers(input);
  if (active.length > 0) {
    lines.push("", "### Active waivers", "");
    for (const waiver of active.slice(0, 10)) lines.push(waiverLine(waiver));
    if (active.length > 10) lines.push(`- …and ${active.length - 10} more active waivers.`);
  }
  if (expired.length > 0) {
    lines.push("", "### Expired waivers", "");
    for (const waiver of expired.slice(0, 10)) lines.push(waiverLine(waiver));
    if (expired.length > 10) lines.push(`- …and ${expired.length - 10} more expired waivers.`);
  }
}

function artifactLine(artifact) {
  const digest = `${artifact.sha256.slice(0, 12)}…`;
  return `- ${code(artifact.name)} · ${code(artifact.kind)} · ${sanitizeInline(artifact.role)} · ${formatBytes(artifact.bytes)} · SHA-256 ${code(digest)}`;
}

function appendArtifacts(lines, artifacts, limit = 10) {
  if (artifacts.length === 0) return;
  lines.push("", "### Evidence artifacts", "");
  for (const artifact of artifacts.slice(0, limit)) lines.push(artifactLine(artifact));
  if (artifacts.length > limit) lines.push(`- …and ${artifacts.length - limit} more artifacts.`);
}

function appendMetrics(lines, metrics, limit) {
  const visible = metricEntries(metrics, limit).filter(([name]) => name !== "durationMs" && name !== "duration_ms");
  if (visible.length === 0) return;
  lines.push("", "### Metrics", "");
  for (const [name, value] of visible) lines.push(`- ${code(name)}: ${value}`);
}

function appendReports(lines, reports, limit = 10) {
  if (reports.length === 0) return;
  lines.push("", "### Reports", "");
  for (const report of reports.slice(0, limit)) lines.push(reportLinkLine(report));
  if (reports.length > limit) lines.push(`- …and ${reports.length - limit} more reports.`);
}

function appendHardwareImpact(lines, impact) {
  if (!impact) return;
  lines.push("", "### Hardware impact", "");
  if (impact.baseline.status === "unavailable") {
    lines.push(
      "Exact base SHA evidence unavailable; the current run result is still valid, but no authoritative PR change comparison was produced.",
    );
    return;
  }

  const domains = impact.assessment.affectedDomains.length;
  lines.push(
    `${impact.assessment.materialChange ? "Material change" : "No material change"} · risk ${sanitizeInline(impact.assessment.riskDirection)} · ${domains} affected ${domains === 1 ? "domain" : "domains"}`,
    "",
    "#### Changed facts",
    "",
    ...hardwareImpactFactLines(impact),
    "",
    "#### Impact assessment",
    "",
    `- Risk direction: ${sanitizeInline(impact.assessment.riskDirection)}`,
    `- Material change: ${impact.assessment.materialChange ? "yes" : "no"}`,
    `- Affected domains: ${impact.assessment.affectedDomains.length > 0 ? impact.assessment.affectedDomains.map(sanitizeInline).join(", ") : "none"}`,
  );
  appendHardwareImpactEvidence(lines, impact.evidence ?? []);
}

function hardwareImpactFactLines(impact) {
  const lines = [];
  const readiness = impact.facts.readiness;
  if (readiness.scoreDelta !== 0 || readiness.statusChanged) {
    lines.push(
      `- Readiness: ${hardwareImpactScore(readiness.previousScore)} → ${hardwareImpactScore(readiness.currentScore)} (${hardwareImpactDelta(readiness.scoreDelta)})`,
    );
  }
  const findings = impact.facts.findings;
  if (findings.added > 0 || findings.resolved > 0) {
    const addedBlockers = hardwareImpactBlockerSuffix(findings.addedBlocking, "new");
    const resolvedBlockers = hardwareImpactBlockerSuffix(findings.resolvedBlocking, "resolved");
    lines.push(`- Findings: +${findings.added} / -${findings.resolved}${addedBlockers}${resolvedBlockers}`);
  }
  const bomChanged = impact.facts.bom.added + impact.facts.bom.removed + impact.facts.bom.changed;
  if (bomChanged > 0) lines.push(`- BOM: ${bomChanged} changed ${bomChanged === 1 ? "row" : "rows"}`);
  const outputsChanged =
    impact.facts.manufacturing.outputsAdded +
    impact.facts.manufacturing.outputsRemoved +
    impact.facts.manufacturing.outputsChanged;
  if (outputsChanged > 0) {
    lines.push(`- Manufacturing: ${outputsChanged} changed ${outputsChanged === 1 ? "output" : "outputs"}`);
  }
  return lines.length > 0 ? lines : ["- No supported v1 facts changed."];
}

function hardwareImpactBlockerSuffix(count, state) {
  if (count <= 0) return "";
  const noun = count === 1 ? "blocker" : "blockers";
  return `; ${count} ${state} ${noun}`;
}

function appendHardwareImpactEvidence(lines, evidence) {
  if (evidence.length === 0) return;
  lines.push("", "#### Supporting evidence", "");
  for (const item of evidence) {
    const metadata = [item.ruleId ? code(item.ruleId) : undefined, item.path ? code(item.path) : undefined]
      .filter(Boolean)
      .join(" · ");
    const metadataSuffix = metadata ? ` · ${metadata}` : "";
    lines.push(`- ${sanitizeInline(item.label)}${metadataSuffix}`);
  }
}

function hardwareImpactScore(value) {
  return value == null ? "n/a" : String(value);
}

function hardwareImpactDelta(value) {
  if (value == null) return "n/a";
  return value > 0 ? `+${value}` : String(value);
}

function nextSteps(input) {
  const outcome = terminalOutcome(input);
  switch (outcome) {
    case "failure":
      return [
        "Resolve the blocking findings and missing required outputs.",
        "Re-run BoardReadyOps and review the updated evidence.",
      ];
    case "warning":
      return [
        "Review warnings and active waivers before approving the release.",
        "Re-run after addressing any risk that should not be accepted.",
      ];
    case "cancelled":
      return ["Start a new BoardReadyOps run when the change is ready for evaluation."];
    case "timedOut":
      return ["Inspect runner logs and capacity, then retry the run."];
    case "superseded":
      return ["Open the latest run and use its result as the source of truth."];
    default:
      return ["Review the evidence bundle and proceed with the release workflow."];
  }
}

function appendNextSteps(lines, input) {
  lines.push("", "### Next steps", "");
  for (const step of nextSteps(input)) lines.push(`- ${step}`);
}

function appendDashboard(lines, detailsUrl) {
  if (!detailsUrl) return;
  lines.push("", `[Open hosted run dashboard](${markdownLinkUrl(detailsUrl)})`);
}

function checkSummary(input) {
  const duration = durationMetric(input.metrics);
  const lines = [`**Status:** ${statusLabel(input.status)}`, `**Decision:** ${decisionLabel(input.decision)}`];
  appendTrustSummary(lines, input, "summary");
  lines.push(
    `**Readiness:** ${readinessValue(input.readiness)}`,
    `**Findings:** ${(input.findings ?? []).length} (${findingsValue(input)})`,
    `**Artifacts:** ${(input.artifacts ?? []).length}`,
    `**Reports:** ${(input.reportLinks ?? []).length}`,
    `**Waivers:** ${waiverValue(input)}`,
    `**Duration:** ${duration === undefined ? "Not reported" : formatDuration(duration)}`,
    `**Severity summary:** ${severitySummary(input.findings ?? [])}`,
  );
  appendFindingSections(lines, input, 5);
  appendReadinessNotes(lines, input.readiness);
  appendWaivers(lines, input);
  appendArtifacts(lines, input.artifacts ?? [], 5);
  appendMetrics(lines, input.metrics, 5);
  appendReports(lines, input.reportLinks ?? [], 5);
  appendHardwareImpact(lines, input.hardwareImpact);
  appendNextSteps(lines, input);
  if (input.detailsUrl) lines.push("", `Open the hosted run dashboard: ${input.detailsUrl}`);
  return lines.join("\n");
}

export function buildReadinessCheckOutput(input) {
  const outcome = presentation(input);
  return {
    title: `${outcome.emoji} BoardReadyOps: ${outcome.label}`,
    summary: checkSummary(input),
  };
}

export function buildReadinessPrComment(input) {
  const outcome = presentation(input);
  const lines = [`## ${outcome.emoji} BoardReadyOps: ${outcome.label}`, "", ...summaryTable(input)];
  appendFindingSections(lines, input, 10);
  appendReadinessNotes(lines, input.readiness);
  appendWaivers(lines, input);
  appendArtifacts(lines, input.artifacts ?? []);
  appendMetrics(lines, input.metrics, 8);
  appendReports(lines, input.reportLinks ?? []);
  appendHardwareImpact(lines, input.hardwareImpact);
  appendNextSteps(lines, input);
  appendDashboard(lines, input.detailsUrl);
  lines.push("", "<!-- boardreadyops:release-readiness -->");
  return `${lines.join("\n")}\n`;
}
