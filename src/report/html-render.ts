import type { FabricationDiff, FabricationOutputDiff } from "../core/diff/fabrication.js";
import type { Finding, Severity } from "../core/findings.js";
import type { ReadinessScore } from "../core/readiness.js";
import type { RunResult } from "../core/result.js";
import { type Locale, type MessageKey, t } from "../i18n/t.js";
import { outputChangeSummary } from "./fabrication-summary.js";

const severities: Severity[] = ["critical", "high", "medium", "low", "info"];

export interface ReportArtifact {
  label: string;
  href: string;
}

export interface Breakdown {
  label: string;
  total: number;
  counts: Record<Severity, number>;
}

export function renderDecisionSection(result: RunResult, locale: Locale): string {
  const status = result.summary.failed ? "fail" : "pass";
  const statusLabel = result.summary.failed
    ? t("report.decision.fail", {}, locale)
    : t("report.decision.pass", {}, locale);
  const readinessBadge = result.readiness
    ? `<span class="badge readiness-${attr(result.readiness.status)}">${escapeHtml(
        readinessStatusLabel(result.readiness.status, locale),
      )}</span>`
    : "";
  const summaryLine = t(
    "report.decision.summary",
    {
      total: result.summary.total,
      critical: result.summary.critical,
      high: result.summary.high,
    },
    locale,
  );
  const readinessLine = result.readiness
    ? `<p class="muted">${escapeHtml(t("report.decision.readiness", { score: result.readiness.score }, locale))}</p>`
    : "";
  let policyBadge = "";
  if (result.policy) {
    const policyKey = result.policy.status === "fail" ? "report.decision.policyFail" : "report.decision.policyPass";
    const policyClass = result.policy.status === "fail" ? "fail" : "pass";
    policyBadge = `<span class="badge decision-badge-${policyClass}">${escapeHtml(t(policyKey, {}, locale))}</span>`;
  }
  return `<section class="decision decision-${status}" aria-labelledby="decision-heading">
      <h2 id="decision-heading">${escapeHtml(t("report.decision.title", {}, locale))}</h2>
      <p class="decision-status">
        <span class="badge decision-badge-${status}">${escapeHtml(statusLabel)}</span>
        ${readinessBadge}
        ${policyBadge}
      </p>
      <p class="muted">${escapeHtml(summaryLine)}</p>
      ${readinessLine}
    </section>`;
}

function waiverState(waiver: NonNullable<RunResult["waivers"]>["active"][number]): {
  label: MessageKey;
  readiness: "ready" | "at-risk" | "blocked";
} {
  if (waiver.expired) {
    return { label: "report.waivers.expired", readiness: "blocked" };
  }
  if (waiver.stale) {
    return { label: "report.waivers.stale", readiness: "at-risk" };
  }
  return { label: "report.waivers.active", readiness: "ready" };
}

export function renderWaiversSection(waivers: NonNullable<RunResult["waivers"]>, locale: Locale): string {
  if (waivers.active.length === 0 && waivers.expired.length === 0) {
    return "";
  }
  const rows = [...waivers.active, ...waivers.expired]
    .map((waiver) => {
      const state = waiverState(waiver);
      return `<tr>
            <td data-label="${attr(t("report.waivers.rule", {}, locale))}"><code>${escapeHtml(waiver.rule)}</code></td>
            <td data-label="${attr(t("report.waivers.owner", {}, locale))}">${escapeHtml(waiver.owner)}</td>
            <td data-label="${attr(t("report.waivers.approvedBy", {}, locale))}">${escapeHtml(waiver.approvedBy ?? "—")}</td>
            <td data-label="${attr(t("report.waivers.reason", {}, locale))}">${escapeHtml(waiver.reason)}</td>
            <td data-label="${attr(t("report.waivers.evidence", {}, locale))}">${escapeHtml(waiver.evidence ?? "—")}</td>
            <td data-label="${attr(t("report.waivers.expires", {}, locale))}">${escapeHtml(waiver.expires ?? "—")}</td>
            <td data-label="${attr(t("report.waivers.state", {}, locale))}"><span class="badge readiness-${state.readiness}">${escapeHtml(
              t(state.label, {}, locale),
            )}</span></td>
          </tr>`;
    })
    .join("\n          ");
  return `<section aria-labelledby="waivers-heading">
      <h2 id="waivers-heading">${escapeHtml(t("report.waivers.title", {}, locale))}</h2>
      <table>
        <caption>${escapeHtml(t("report.waivers.caption", {}, locale))}</caption>
        <thead>
          <tr><th scope="col">${escapeHtml(t("report.waivers.rule", {}, locale))}</th><th scope="col">${escapeHtml(
            t("report.waivers.owner", {}, locale),
          )}</th><th scope="col">${escapeHtml(t("report.waivers.approvedBy", {}, locale))}</th><th scope="col">${escapeHtml(
            t("report.waivers.reason", {}, locale),
          )}</th><th scope="col">${escapeHtml(t("report.waivers.evidence", {}, locale))}</th><th scope="col">${escapeHtml(
            t("report.waivers.expires", {}, locale),
          )}</th><th scope="col">${escapeHtml(t("report.waivers.state", {}, locale))}</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;
}

export function renderArtifactsSection(artifacts: ReportArtifact[], locale: Locale): string {
  if (artifacts.length === 0) {
    return "";
  }
  const items = artifacts
    .map((artifact) => `<li><a href="${attr(artifact.href)}">${escapeHtml(artifact.label)}</a></li>`)
    .join("\n        ");
  return `<section aria-labelledby="artifacts-heading">
      <h2 id="artifacts-heading">${escapeHtml(t("report.artifacts", {}, locale))}</h2>
      <ul>
        ${items}
      </ul>
    </section>`;
}

export function summaryCards(result: RunResult, locale: Locale): string {
  const metrics = [
    { label: t("report.total", {}, locale), count: result.summary.total },
    ...severities.map((severity) => ({ label: severityLabel(severity, locale), count: result.summary[severity] })),
  ];
  return metrics
    .map(
      (metric) => `<article class="metric">
          <strong>${metric.count}</strong>
          <span>${escapeHtml(metric.label)}</span>
        </article>`,
    )
    .join("\n        ");
}

const readinessStatusLabelKeys = {
  ready: "report.readiness.status.ready",
  "at-risk": "report.readiness.status.atRisk",
  blocked: "report.readiness.status.blocked",
} as const;

function readinessStatusLabel(status: ReadinessScore["status"], locale: Locale): string {
  return t(readinessStatusLabelKeys[status], {}, locale);
}

export function renderReadinessSection(readiness: ReadinessScore, locale: Locale): string {
  const profileLine = readiness.profile
    ? `<p class="muted">${escapeHtml(
        t("report.readiness.profile", { name: readiness.profile.name, id: readiness.profile.id }, locale),
      )}</p>`
    : `<p class="muted">${escapeHtml(t("report.readiness.noProfile", {}, locale))}</p>`;
  const findingsLine = `<p class="muted">${escapeHtml(
    t("report.readiness.findingsSummary", { blocking: readiness.blocking, nonBlocking: readiness.nonBlocking }, locale),
  )}</p>`;
  const evidence = readiness.evidence.length > 0 ? renderReadinessEvidence(readiness, locale) : "";
  const warnings =
    readiness.warnings.length > 0
      ? `<div class="panel">
          <h3>${escapeHtml(t("report.readiness.warnings", {}, locale))}</h3>
          <ul>
            ${readiness.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("\n            ")}
          </ul>
        </div>`
      : "";
  return `<section aria-labelledby="readiness-heading">
      <h2 id="readiness-heading">${escapeHtml(t("report.readiness.title", {}, locale))}</h2>
      <p class="readiness-score">
        <strong>${readiness.score}/100</strong>
        <span class="badge readiness-${attr(readiness.status)}">${escapeHtml(readinessStatusLabel(readiness.status, locale))}</span>
      </p>
      ${profileLine}
      ${findingsLine}
      ${evidence}
      ${warnings}
    </section>`;
}

function renderReadinessEvidence(readiness: ReadinessScore, locale: Locale): string {
  const importanceLabel = {
    required: t("report.readiness.required", {}, locale),
    recommended: t("report.readiness.recommended", {}, locale),
  };
  const rows = readiness.evidence
    .map(
      (entry) => `<tr>
            <td data-label="${attr(t("report.readiness.output", {}, locale))}"><code>${escapeHtml(entry.output)}</code></td>
            <td data-label="${attr(t("report.readiness.importance", {}, locale))}">${escapeHtml(importanceLabel[entry.importance])}</td>
            <td data-label="${attr(t("report.readiness.evidenceStatus", {}, locale))}">${escapeHtml(
              entry.present ? t("report.readiness.present", {}, locale) : t("report.readiness.missing", {}, locale),
            )}</td>
          </tr>`,
    )
    .join("\n          ");
  return `<table>
        <caption>${escapeHtml(t("report.readiness.evidence", {}, locale))}</caption>
        <thead>
          <tr><th scope="col">${escapeHtml(t("report.readiness.output", {}, locale))}</th><th scope="col">${escapeHtml(
            t("report.readiness.importance", {}, locale),
          )}</th><th scope="col">${escapeHtml(t("report.readiness.evidenceStatus", {}, locale))}</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;
}

type DiffStatus = FabricationOutputDiff["status"];

export function renderReleaseDiffSection(fabrication: FabricationDiff, locale: Locale): string {
  return `<section class="release-diff" aria-labelledby="fabrication-diff-heading">
      <h2 id="fabrication-diff-heading">${escapeHtml(t("report.fabricationChanges", {}, locale))}</h2>
      ${renderBomDiff(fabrication.bom, locale)}
      ${renderOutputDiff(fabrication.outputs, locale)}
      ${renderNewFindingsDiff(fabrication.findings.added, locale)}
    </section>`;
}

function renderBomDiff(bom: FabricationDiff["bom"], locale: Locale): string {
  if (bom.rows.length === 0) {
    return `<p class="muted">${escapeHtml(t("report.noBomChanges", {}, locale))}</p>`;
  }
  const headers = `<tr><th scope="col">${escapeHtml(t("report.ref", {}, locale))}</th><th scope="col">${escapeHtml(
    t("report.previous", {}, locale),
  )}</th><th scope="col">${escapeHtml(t("report.current", {}, locale))}</th><th scope="col">${escapeHtml(
    t("report.status", {}, locale),
  )}</th></tr>`;
  const rows = bom.rows
    .map(
      (row) => `<tr>
            <td data-label="${attr(t("report.ref", {}, locale))}"><code>${escapeHtml(row.reference)}</code></td>
            <td data-label="${attr(t("report.previous", {}, locale))}">${escapeHtml(row.previous || "—")}</td>
            <td data-label="${attr(t("report.current", {}, locale))}">${escapeHtml(row.current || "—")}</td>
            <td data-label="${attr(t("report.status", {}, locale))}">${diffStatusBadge(row.status, locale)}</td>
          </tr>`,
    )
    .join("\n          ");
  const truncated = bom.truncated ? `<p class="muted">${escapeHtml(t("report.bomDiffTruncated", {}, locale))}</p>` : "";
  return `<table>
        <caption>${escapeHtml(t("report.bom", {}, locale))}</caption>
        <thead>
          ${headers}
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>${truncated}`;
}

function renderOutputDiff(outputs: FabricationOutputDiff[], locale: Locale): string {
  if (outputs.length === 0) {
    return "";
  }
  const headers = `<tr><th scope="col">${escapeHtml(t("report.diff.output", {}, locale))}</th><th scope="col">${escapeHtml(
    t("report.status", {}, locale),
  )}</th><th scope="col">${escapeHtml(t("report.diff.changes", {}, locale))}</th></tr>`;
  const rows = outputs
    .map(
      (output) => `<tr>
            <td data-label="${attr(t("report.diff.output", {}, locale))}"><code>${escapeHtml(output.kind)}</code></td>
            <td data-label="${attr(t("report.status", {}, locale))}">${diffStatusBadge(output.status, locale)}</td>
            <td data-label="${attr(t("report.diff.changes", {}, locale))}">${escapeHtml(
              outputChangeSummary(output, locale) || "—",
            )}</td>
          </tr>`,
    )
    .join("\n          ");
  return `<table>
        <caption>${escapeHtml(t("report.manufacturingOutputs", {}, locale))}</caption>
        <thead>
          ${headers}
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;
}

function renderNewFindingsDiff(added: Finding[], locale: Locale): string {
  if (added.length === 0) {
    return "";
  }
  const shown = added.slice(0, 10);
  const items = shown
    .map(
      (finding) => `<li>
            <span class="badge severity-${attr(finding.severity)}">${escapeHtml(severityLabel(finding.severity, locale))}</span>
            <code>${escapeHtml(finding.ruleId)}</code> ${escapeHtml(finding.message)}
          </li>`,
    )
    .join("\n          ");
  const remaining = added.length - shown.length;
  const more =
    remaining > 0
      ? `<li class="muted">${escapeHtml(t("report.moreNewFindings", { count: remaining }, locale))}</li>`
      : "";
  return `<h3>${escapeHtml(t("report.newFindings", {}, locale))}</h3>
      <ul class="diff-findings">
        ${items}
        ${more}
      </ul>`;
}

function diffStatusBadge(status: DiffStatus, locale: Locale): string {
  const labelKey = {
    added: "report.diff.status.added",
    removed: "report.diff.status.removed",
    changed: "report.diff.status.changed",
    unchanged: "report.diff.status.unchanged",
  } as const;
  return `<span class="badge diff-${status}">${escapeHtml(t(labelKey[status], {}, locale))}</span>`;
}

export function projectBreakdown(result: RunResult): Breakdown[] {
  const projects = new Map<string, Breakdown>();
  for (const project of result.projects) {
    projects.set(project.projectFile, emptyBreakdown(project.projectFile));
  }
  for (const finding of result.findings) {
    const label = finding.project ?? "Unassigned";
    const entry = projects.get(label) ?? emptyBreakdown(label);
    entry.total += 1;
    entry.counts[finding.severity] += 1;
    projects.set(label, entry);
  }
  return [...projects.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function ruleBreakdown(findings: Finding[]): Breakdown[] {
  const rules = new Map<string, Breakdown>();
  for (const finding of findings) {
    const entry = rules.get(finding.ruleId) ?? emptyBreakdown(finding.ruleId);
    entry.total += 1;
    entry.counts[finding.severity] += 1;
    rules.set(finding.ruleId, entry);
  }
  return [...rules.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function emptyBreakdown(label: string): Breakdown {
  return {
    label,
    total: 0,
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  };
}

export function renderProjectPanel(project: Breakdown, locale: Locale): string {
  return `<article class="panel">
          <h3><code>${escapeHtml(project.label)}</code></h3>
          <p><strong>${project.total}</strong> ${escapeHtml(findingWord(project.total, locale))}</p>
          <p class="muted">${severityCounts(project, locale)}</p>
        </article>`;
}

export function renderRuleRow(rule: Breakdown, locale: Locale): string {
  const labels = htmlLabels(locale);
  return `<tr>
            <td data-label="${attr(labels.rule)}"><code>${escapeHtml(rule.label)}</code></td>
            <td data-label="${attr(labels.total)}">${rule.total}</td>
            <td data-label="${attr(labels.severityCounts)}">${severityCounts(rule, locale)}</td>
          </tr>`;
}

export function renderFindingRow(finding: Finding, locale: Locale): string {
  const labels = htmlLabels(locale);
  const project = finding.project ?? t("report.unassigned", {}, locale);
  return `<tr data-severity="${attr(finding.severity)}" data-rule="${attr(finding.ruleId)}" data-project="${attr(project)}">
            <td data-label="${attr(labels.severity)}"><span class="badge severity-${attr(finding.severity)}">${escapeHtml(severityLabel(finding.severity, locale))}</span></td>
            <td data-label="${attr(labels.rule)}"><code>${escapeHtml(finding.ruleId)}</code></td>
            <td data-label="${attr(labels.project)}"><code>${escapeHtml(project)}</code></td>
            <td data-label="${attr(labels.finding)}">
              ${escapeHtml(finding.message)}
              <details>
                <summary>${escapeHtml(labels.details)}</summary>
                <div class="detail-grid">
                  <section>
                    <h3>${escapeHtml(labels.resource)}</h3>
                    <p><code>${escapeHtml(finding.resource.path)}</code> <span class="muted">(${escapeHtml(finding.resource.kind)})</span></p>
                    ${locationHtml(finding, locale)}
                  </section>
                  ${detailsHtml(finding, locale)}
                  ${fixHtml(finding, locale)}
                  ${referencesHtml(finding, locale)}
                </div>
              </details>
            </td>
          </tr>`;
}

function locationHtml(finding: Finding, locale: Locale): string {
  const values: string[] = [];
  if (finding.location?.region) {
    values.push(
      t(
        "report.location.lines",
        {
          startLine: finding.location.region.startLine,
          endLine: finding.location.region.endLine,
        },
        locale,
      ),
    );
  } else if (finding.location?.line) {
    values.push(t("report.location.line", { line: finding.location.line }, locale));
  }
  if (finding.location?.column) {
    values.push(t("report.location.column", { column: finding.location.column }, locale));
  }
  if (finding.location?.boardCoordinates) {
    const coordinates = finding.location.boardCoordinates;
    values.push(
      `${coordinates.layer ?? t("report.location.board", {}, locale)} (${formatNumber(coordinates.x)}${coordinates.units}, ${formatNumber(
        coordinates.y,
      )}${coordinates.units})`,
    );
  }
  return values.length > 0
    ? `<p>${escapeHtml(values.join(", "))}</p>`
    : `<p class="muted">${escapeHtml(t("report.noLocation", {}, locale))}</p>`;
}

function detailsHtml(finding: Finding, locale: Locale): string {
  if (!finding.details && !finding.confidence) {
    return "";
  }
  const detail = JSON.stringify(finding.details ?? {}, null, 2);
  return `<section>
                    <h3>${escapeHtml(t("report.context", {}, locale))}</h3>
                    ${finding.confidence ? `<p>${escapeHtml(t("report.confidence", {}, locale))}: ${escapeHtml(finding.confidence)}</p>` : ""}
                    ${finding.details ? `<pre><code>${escapeHtml(detail)}</code></pre>` : ""}
                  </section>`;
}

function fixHtml(finding: Finding, locale: Locale): string {
  if (!finding.fix) {
    return `<section><h3>${escapeHtml(t("report.fix", {}, locale))}</h3><p class="muted">${escapeHtml(
      t("report.noFix", {}, locale),
    )}</p></section>`;
  }
  const stepList = finding.fix.steps?.map((step) => `<li>${escapeHtml(step)}</li>`).join("") ?? "";
  const steps = stepList.length > 0 ? `<ol>${stepList}</ol>` : "";
  return `<section>
                    <h3>${escapeHtml(t("report.fix", {}, locale))}</h3>
                    <p>${escapeHtml(finding.fix.description)}</p>
                    ${steps}
                  </section>`;
}

function referencesHtml(finding: Finding, locale: Locale): string {
  const references = [...(finding.references ?? []), ...(finding.fix?.references ?? [])];
  if (references.length === 0) {
    return `<section><h3>${escapeHtml(t("report.references", {}, locale))}</h3><p class="muted">${escapeHtml(
      t("report.noReferences", {}, locale),
    )}</p></section>`;
  }
  return `<section>
                    <h3>${escapeHtml(t("report.references", {}, locale))}</h3>
                    <ul>${references
                      .map((reference) => `<li><a href="${attr(reference)}">${escapeHtml(reference)}</a></li>`)
                      .join("")}</ul>
                  </section>`;
}

export function filterOptions(
  findings: Finding[],
  locale: Locale,
): { severities: Severity[]; rules: string[]; projects: string[] } {
  return {
    severities: severities.filter((severity) => findings.some((finding) => finding.severity === severity)),
    rules: uniqueSorted(findings.map((finding) => finding.ruleId)),
    projects: uniqueSorted(findings.map((finding) => finding.project ?? t("report.unassigned", {}, locale))),
  };
}

export function htmlLabels(locale: Locale) {
  return {
    allProjects: t("report.allProjects", {}, locale),
    allRules: t("report.allRules", {}, locale),
    allSeverities: t("report.allSeverities", {}, locale),
    details: t("report.details", {}, locale),
    filterFindings: t("report.filterFindings", {}, locale),
    filterableFindingList: t("report.filterableFindingList", {}, locale),
    finding: t("report.finding", {}, locale),
    findings: t("report.findings", {}, locale),
    groupedByRule: t("report.groupedByRule", {}, locale),
    noFindings: t("report.noFindings", {}, locale),
    noProjects: t("report.noProjects", {}, locale),
    noRules: t("report.noRules", {}, locale),
    perProjectBreakdown: t("report.perProjectBreakdown", {}, locale),
    perRuleGrouping: t("report.perRuleGrouping", {}, locale),
    project: t("report.project", {}, locale),
    resource: t("report.resource", {}, locale),
    rule: t("report.rule", {}, locale),
    severity: t("report.severity", {}, locale),
    severityCounts: t("report.severityCounts", {}, locale),
    summaryBySeverity: t("report.summaryBySeverity", {}, locale),
    thresholdFailed: t("report.threshold.failed", {}, locale),
    thresholdPassed: t("report.threshold.passed", {}, locale),
    title: t("report.title", {}, locale),
    total: t("report.total", {}, locale),
  };
}

export function severityLabel(severity: Severity, locale: Locale): string {
  if (locale === "en") {
    return severity;
  }
  switch (severity) {
    case "critical":
      return t("severity.critical", {}, locale);
    case "high":
      return t("severity.high", {}, locale);
    case "medium":
      return t("severity.medium", {}, locale);
    case "low":
      return t("severity.low", {}, locale);
    case "info":
      return t("severity.info", {}, locale);
  }
}

function severityCounts(row: Breakdown, locale: Locale): string {
  return (
    severities
      .filter((severity) => row.counts[severity] > 0)
      .map((severity) => `${row.counts[severity]} ${severityLabel(severity, locale)}`)
      .join(", ") || t("report.finding.count", { count: 0 }, locale)
  );
}

export function emptyPanel(message: string): string {
  return `<div class="panel empty">${escapeHtml(message)}</div>`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function attr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function findingWord(count: number, locale: Locale): string {
  return count === 1 ? t("report.finding.word", {}, locale) : t("report.finding.word.plural", {}, locale);
}
