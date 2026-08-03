import type { FabricationDiff } from "../core/diff/fabrication.js";
import type { RunResult } from "../core/result.js";
import { type Locale, t } from "../i18n/t.js";
import { reportCss } from "./html-css.js";
import {
  emptyPanel,
  filterOptions,
  htmlLabels,
  projectBreakdown,
  type ReportArtifact,
  renderArtifactsSection,
  renderDecisionSection,
  renderFindingRow,
  renderProjectPanel,
  renderReadinessSection,
  renderReleaseDiffSection,
  renderRuleRow,
  renderWaiversSection,
  ruleBreakdown,
  severityLabel,
  summaryCards,
} from "./html-render.js";

export function formatHtml(
  result: RunResult,
  locale: Locale = "en",
  artifacts: ReportArtifact[] = [],
  fabrication?: FabricationDiff,
): string {
  const labels = htmlLabels(locale);
  const projectRows = projectBreakdown(result);
  const ruleRows = ruleBreakdown(result.findings);
  const filter = filterOptions(result.findings, locale);
  const visibleCount = t("report.finding.count", { count: result.findings.length }, locale);
  const lang = locale === "__PSEUDO__" ? "en" : locale;
  const pluralScript =
    locale === "en"
      ? 'const plural = (count) => count === 1 ? "finding" : "findings";'
      : `const singularFinding = ${JSON.stringify(t("report.finding.word", {}, locale))};
    const pluralFinding = ${JSON.stringify(t("report.finding.word.plural", {}, locale))};
    const plural = (count) => count === 1 ? singularFinding : pluralFinding;`;
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(labels.title)}</title>
  <style>
    ${reportCss}
  </style>
</head>
<body>
  <header>
    <h1>${htmlEscape(labels.title)}</h1>
    <p class="metadata">${htmlEscape(
      t(
        "report.generatedMetadata",
        {
          date: result.generatedAt,
          tool: result.tool.name,
          version: result.tool.version,
          threshold: result.summary.failed ? labels.thresholdFailed : labels.thresholdPassed,
        },
        locale,
      ),
    )}</p>
  </header>
  <main>
    ${renderDecisionSection(result, locale)}
    ${fabrication ? renderReleaseDiffSection(fabrication, locale) : ""}
    ${result.readiness ? renderReadinessSection(result.readiness, locale) : ""}
    ${result.waivers ? renderWaiversSection(result.waivers, locale) : ""}
    ${renderArtifactsSection(artifacts, locale)}
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading">${htmlEscape(labels.summaryBySeverity)}</h2>
      <div class="summary-grid">
        ${summaryCards(result, locale)}
      </div>
    </section>

    <section aria-labelledby="project-heading">
      <h2 id="project-heading">${htmlEscape(labels.perProjectBreakdown)}</h2>
      <div class="breakdown-grid">
        ${projectRows.length > 0 ? projectRows.map((row) => renderProjectPanel(row, locale)).join("\n        ") : emptyPanel(labels.noProjects)}
      </div>
    </section>

    <section aria-labelledby="rule-heading">
      <h2 id="rule-heading">${htmlEscape(labels.perRuleGrouping)}</h2>
      ${
        ruleRows.length > 0
          ? `<table>
        <caption>${htmlEscape(labels.groupedByRule)}</caption>
        <thead>
          <tr><th scope="col">${htmlEscape(labels.rule)}</th><th scope="col">${htmlEscape(
            labels.total,
          )}</th><th scope="col">${htmlEscape(labels.severityCounts)}</th></tr>
        </thead>
        <tbody>
          ${ruleRows.map((row) => renderRuleRow(row, locale)).join("\n          ")}
        </tbody>
      </table>`
          : emptyPanel(labels.noRules)
      }
    </section>

    <section aria-labelledby="findings-heading">
      <h2 id="findings-heading">${htmlEscape(labels.findings)}</h2>
      <section class="filter-bar" aria-label="${htmlAttr(labels.filterFindings)}">
        <label>${htmlEscape(labels.severity)}
          <select id="severity-filter" data-filter="severity">
            <option value="">${htmlEscape(labels.allSeverities)}</option>
            ${filter.severities.map((severity) => `<option value="${htmlAttr(severity)}">${htmlEscape(severityLabel(severity, locale))}</option>`).join("\n            ")}
          </select>
        </label>
        <label>${htmlEscape(labels.rule)}
          <select id="rule-filter" data-filter="rule">
            <option value="">${htmlEscape(labels.allRules)}</option>
            ${filter.rules.map((rule) => `<option value="${htmlAttr(rule)}">${htmlEscape(rule)}</option>`).join("\n            ")}
          </select>
        </label>
        <label>${htmlEscape(labels.project)}
          <select id="project-filter" data-filter="project">
            <option value="">${htmlEscape(labels.allProjects)}</option>
            ${filter.projects.map((project) => `<option value="${htmlAttr(project)}">${htmlEscape(project)}</option>`).join("\n            ")}
          </select>
        </label>
        <output class="count" id="visible-count" aria-live="polite">${htmlEscape(visibleCount)}</output>
      </section>
      ${
        result.findings.length > 0
          ? `<table id="findings-table">
        <caption>${htmlEscape(labels.filterableFindingList)}</caption>
        <thead>
          <tr><th scope="col">${htmlEscape(labels.severity)}</th><th scope="col">${htmlEscape(
            labels.rule,
          )}</th><th scope="col">${htmlEscape(labels.project)}</th><th scope="col">${htmlEscape(
            labels.finding,
          )}</th></tr>
        </thead>
        <tbody>
          ${result.findings.map((finding) => renderFindingRow(finding, locale)).join("\n          ")}
        </tbody>
      </table>`
          : emptyPanel(labels.noFindings)
      }
    </section>
  </main>
  <script>
    "use strict";
    const filters = Array.from(document.querySelectorAll("[data-filter]"));
    const rows = Array.from(document.querySelectorAll("#findings-table tbody tr"));
    const counter = document.getElementById("visible-count");
    ${pluralScript}
    const applyFilters = () => {
      const active = Object.fromEntries(filters.map((filter) => [filter.dataset.filter, filter.value]));
      let visible = 0;
      for (const row of rows) {
        const matched = (!active.severity || row.dataset.severity === active.severity)
          && (!active.rule || row.dataset.rule === active.rule)
          && (!active.project || row.dataset.project === active.project);
        row.hidden = !matched;
        if (matched) {
          visible += 1;
        }
      }
      if (counter) {
        counter.value = visible + " " + plural(visible);
        counter.textContent = counter.value;
      }
    };
    for (const filter of filters) {
      filter.addEventListener("change", applyFilters);
    }
  </script>
</body>
</html>
`;
  return `${html
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()}\n`;
}

function htmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function htmlAttr(value: string): string {
  return htmlEscape(value).replaceAll("'", "&#39;");
}
