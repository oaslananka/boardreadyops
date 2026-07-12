#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const DOCS_PATTERNS = [
  /^docs\//,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^CONTRIBUTING\.md$/,
  /^SECURITY\.md$/,
  /^SUPPORT\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^mkdocs\.yml$/,
  /^typedoc\.json$/,
  /^\.coderabbit\.yaml$/,
];

const DOCS_GENERATION_PATTERNS = [
  /^scripts\/(docs-build|generate-api-docs|generate-release-history|generate-rule-docs|update-action-inputs-docs)\.mjs$/,
  /^scripts\/check-docs-a11y\.mjs$/,
  /^docs\/requirements\.txt$/,
  /^packages\/plugin-sdk\//,
];

const WORKFLOW_PATTERNS = [/^\.github\/workflows\//, /^scripts\/setup-branch-protection\.sh$/];
const DEPENDENCY_PATTERNS = [/^package\.json$/, /^pnpm-lock\.yaml$/, /^\.nvmrc$/, /^pnpm-workspace\.yaml$/];
const BUILD_PATTERNS = [
  /^src\//,
  /^tests\//,
  /^scripts\//,
  /^dist\//,
  /^action\.yml$/,
  /^tsconfig/,
  /^vitest\./,
  /^stryker\.config\./,
  /^eslint/,
  /^biome\.json$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
];
const ACTION_PATTERNS = [
  /^action\.yml$/,
  /^dist\/action\//,
  /^src\/action\//,
  /^tests\/action\//,
  /^tests\/unit\/action\//,
];
const KICAD_PATTERNS = [/^src\/kicad\//, /^tests\/(unit|integration)\/kicad\//, /^tests\/fixtures\/projects\//];
const INTEGRATION_PATTERNS = [
  /^tests\/integration\//,
  /^packages\/(contracts|cloud-core|db)\//,
  /^apps\/web\//,
  /^\.github\/workflows\/ci\.ya?ml$/,
];
const RULE_PATTERNS = [
  /^src\/rules\//,
  /^tests\/unit\/rules\//,
  /^docs\/rules\//,
  /^scripts\/generate-rule-docs\.mjs$/,
];
const PARSER_MODEL_PATTERNS = [/^src\/kicad\//, /^tests\/unit\/kicad\//];
const SECURITY_PATTERNS = [
  /^SECURITY\.md$/,
  /^\.github\/workflows\/(security|trivy|provenance|publish-npm)\.ya?ml$/,
  /^scripts\/(check-licenses|check-reuse|check-scorecard-baseline|generate-sbom)\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^NOTICE$/,
  /^LICENSES\//,
  /^REUSE\.toml$/,
];
const PACKAGE_PATTERNS = [
  /^dist\//,
  /^scripts\/build\.mjs$/,
  /^scripts\/verify-dist\.mjs$/,
  /^scripts\/check-bundle-sizes\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^action\.yml$/,
];
const PATH_PATTERNS = [
  /path/i,
  /^src\/(core|kicad|cli|release|vendor)\//,
  /^tests\/integration\/cross-platform-paths\.test\.ts$/,
];
const REPORT_PATTERNS = [/^src\/report\//, /^tests\/unit\/report\//, /^docs\//, /^mkdocs\.yml$/];
// Mirrors the vitest coverage `include` set so the coverage gate runs whenever a
// measured source file (or any test/config that affects it) changes.
const COVERAGE_PATTERNS = [
  /^src\/(core|rules|bom|pinmap|report|kicad|notifiers)\//,
  /^src\/action\/inputs\.ts$/,
  /^tests\//,
  /^vitest\.config\.[cm]?ts$/,
];

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

function uniqueCleanFiles(files) {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort();
}

function isDocsOnlyFile(file) {
  return matchesAny(file, DOCS_PATTERNS);
}

export function classifyChangedFiles(files, options = {}) {
  const eventName = options.eventName ?? process.env.GITHUB_EVENT_NAME ?? "pull_request";
  const forceFull =
    options.forceFull ?? (eventName === "push" || eventName === "schedule" || eventName === "workflow_dispatch");
  const changedFiles = uniqueCleanFiles(files);
  const hasChanges = changedFiles.length > 0;

  const docsChanged =
    forceFull || changedFiles.some((file) => isDocsOnlyFile(file) || matchesAny(file, DOCS_GENERATION_PATTERNS));
  const workflowChanged = forceFull || changedFiles.some((file) => matchesAny(file, WORKFLOW_PATTERNS));
  const dependencyChanged = forceFull || changedFiles.some((file) => matchesAny(file, DEPENDENCY_PATTERNS));
  const buildChanged = forceFull || changedFiles.some((file) => matchesAny(file, BUILD_PATTERNS));
  const actionChanged = forceFull || changedFiles.some((file) => matchesAny(file, ACTION_PATTERNS));
  const kicadChanged = forceFull || changedFiles.some((file) => matchesAny(file, KICAD_PATTERNS));
  const integrationChanged = forceFull || changedFiles.some((file) => matchesAny(file, INTEGRATION_PATTERNS));
  const ruleChanged = forceFull || changedFiles.some((file) => matchesAny(file, RULE_PATTERNS));
  const parserModelChanged = forceFull || changedFiles.some((file) => matchesAny(file, PARSER_MODEL_PATTERNS));
  const securityChanged = forceFull || changedFiles.some((file) => matchesAny(file, SECURITY_PATTERNS));
  const packageChanged = forceFull || changedFiles.some((file) => matchesAny(file, PACKAGE_PATTERNS));
  const pathSensitiveChanged = forceFull || changedFiles.some((file) => matchesAny(file, PATH_PATTERNS));
  const reportChanged = forceFull || changedFiles.some((file) => matchesAny(file, REPORT_PATTERNS));

  const docsOnly = hasChanges && !forceFull && changedFiles.every(isDocsOnlyFile);
  const codeChanged =
    forceFull ||
    (!docsOnly && changedFiles.some((file) => matchesAny(file, BUILD_PATTERNS) || matchesAny(file, WORKFLOW_PATTERNS)));
  const releaseCritical = forceFull || packageChanged || dependencyChanged || workflowChanged;
  const coverageCritical = forceFull || changedFiles.some((file) => matchesAny(file, COVERAGE_PATTERNS));
  const mutationCritical =
    forceFull ||
    ruleChanged ||
    parserModelChanged ||
    changedFiles.some((file) => /^src\/core\//.test(file) || /^scripts\/check-mutation-thresholds\.mjs$/.test(file));

  return {
    changed_files: changedFiles.join(","),
    docs_only: docsOnly,
    code_changed: codeChanged,
    docs_changed: docsChanged,
    workflow_changed: workflowChanged,
    dependency_changed: dependencyChanged,
    build_changed: buildChanged,
    action_changed: actionChanged,
    kicad_changed: kicadChanged,
    rule_changed: ruleChanged,
    security_changed: securityChanged,
    package_changed: packageChanged,
    path_sensitive_changed: pathSensitiveChanged,
    report_changed: reportChanged,
    needs_lint: true,
    needs_typecheck: codeChanged || workflowChanged || dependencyChanged,
    needs_unit: codeChanged || dependencyChanged,
    needs_unit_matrix: forceFull || pathSensitiveChanged || dependencyChanged || workflowChanged,
    needs_integration: forceFull || integrationChanged || kicadChanged || dependencyChanged,
    needs_cross_platform: forceFull || pathSensitiveChanged || dependencyChanged,
    needs_action_smoke: forceFull || actionChanged || packageChanged,
    needs_accessibility: forceFull || reportChanged || docsChanged,
    needs_build: buildChanged || dependencyChanged || packageChanged,
    needs_dist: packageChanged || actionChanged || buildChanged,
    needs_coverage: coverageCritical,
    needs_mutation: mutationCritical,
    needs_security: releaseCritical || securityChanged,
    needs_sbom: forceFull || dependencyChanged || securityChanged,
    needs_docs: docsChanged,
    full_run: forceFull,
  };
}

function serializeGithubOutput(profile) {
  return Object.entries(profile)
    .map(([key, value]) => `${key}=${typeof value === "boolean" ? String(value) : value}`)
    .join("\n");
}

export function readFilesFromArg(path) {
  if (!path || path === "-") {
    return fs.readFileSync(0, "utf8").split(/\r?\n/u);
  }
  return fs.readFileSync(path, "utf8").split(/\r?\n/u);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readFilesFromArg(process.argv[2]);
  const profile = classifyChangedFiles(files);
  const output = serializeGithubOutput(profile);
  const summary = [
    "# CI risk profile",
    "",
    `Changed files: ${profile.changed_files || "(none)"}`,
    `Docs only: ${profile.docs_only}`,
    `Needs unit matrix: ${profile.needs_unit_matrix}`,
    `Needs integration: ${profile.needs_integration}`,
    `Needs coverage: ${profile.needs_coverage}`,
    `Needs mutation: ${profile.needs_mutation}`,
    `Needs security: ${profile.needs_security}`,
    "",
  ].join("\n");

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
