#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const REQUIRED = "Required";
const NOT_APPLICABLE = "Not applicable";

/**
 * @typedef {object} SecurityGateInput
 * @property {string} eventName
 * @property {boolean} forkPullRequest
 * @property {{codeScan: boolean, dependencyScan: boolean, compliance: boolean, sbom: boolean}} policy
 * @property {{
 *   policy: string,
 *   codeql: string,
 *   semgrep: string,
 *   gitleaks: string,
 *   dependencyReview: string,
 *   osvPullRequest: string,
 *   osvFull: string,
 *   compliance: string,
 *   sbom: string,
 * }} results
 */

/**
 * @param {SecurityGateInput} input
 * @returns {{ok: boolean, failures: string[], summary: string}}
 */
export function evaluateSecurityGate(input) {
  const rows = [];

  addRow(rows, "Security policy", true, input.results.policy, "Risk classifier must complete successfully");

  const codeReason = input.forkPullRequest
    ? "Fork pull request uses a read-only token; CodeQL SARIF publication is evaluated after merge"
    : "No executable or workflow changes";
  addRow(rows, "CodeQL", input.policy.codeScan && !input.forkPullRequest, input.results.codeql, codeReason);
  addRow(rows, "Semgrep", input.policy.codeScan, input.results.semgrep, "No executable or workflow changes");
  addRow(rows, "Gitleaks", true, input.results.gitleaks, "Secret scanning is mandatory for every run");

  const pullRequest = input.eventName === "pull_request";
  addRow(
    rows,
    "Dependency Review",
    pullRequest && input.policy.dependencyScan,
    input.results.dependencyReview,
    pullRequest ? "No dependency inventory changes" : "Only pull requests have a dependency diff",
  );

  if (pullRequest) {
    addRow(
      rows,
      "OSV dependency diff",
      input.policy.dependencyScan,
      input.results.osvPullRequest,
      "No dependency inventory changes",
    );
  } else {
    addRow(rows, "OSV full scan", true, input.results.osvFull, "Full scans run on trusted non-PR events");
  }

  addRow(
    rows,
    "Repository compliance",
    input.policy.compliance,
    input.results.compliance,
    "No release, dependency, workflow, or security-policy changes",
  );
  addRow(rows, "SBOM generation", input.policy.sbom, input.results.sbom, "Dependency inventory is unchanged");

  const failures = rows
    .filter((row) => row.applicable && row.result !== "success")
    .map((row) => `${row.name}: ${row.result || "missing"}`);
  const ok = failures.length === 0;
  const lines = [
    `# Security merge gate: ${ok ? "passed" : "failed"}`,
    "",
    "| Check | Policy | Result | Reason |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.name} | ${row.applicable ? REQUIRED : NOT_APPLICABLE} | ${row.result || "missing"} | ${row.reason} |`,
    ),
    "",
  ];

  if (!ok) {
    lines.push("## Blocking results", "", ...failures.map((failure) => `- ${failure}`), "");
  }

  return { ok, failures, summary: lines.join("\n") };
}

function addRow(rows, name, applicable, result, nonApplicableReason) {
  rows.push({
    name,
    applicable,
    result,
    reason: applicable ? "Mandatory for this change profile" : nonApplicableReason,
  });
}

export function main() {
  const raw = process.env.SECURITY_GATE_INPUT;
  if (!raw) {
    throw new Error("SECURITY_GATE_INPUT is required");
  }

  const result = evaluateSecurityGate(JSON.parse(raw));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
  } else {
    process.stdout.write(`${result.summary}\n`);
  }

  if (!result.ok) {
    throw new Error(`Security merge gate failed:\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
