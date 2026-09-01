import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mergify = readFileSync(".mergify.yml", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const mainRuleset = JSON.parse(readFileSync(".github/rulesets/main.json", "utf8")) as {
  rules: Array<{
    type: string;
    parameters?: {
      required_status_checks?: Array<{ context: string }>;
      strict_required_status_checks_policy?: boolean;
    };
  }>;
};

const stableRequiredChecks =
  mainRuleset.rules
    .find((rule) => rule.type === "required_status_checks")
    ?.parameters?.required_status_checks?.map(({ context }) => context) ?? [];

function readQueueConditionList(name: "queue_conditions" | "merge_conditions"): string[] {
  const lines = mergify.split(/\r?\n/u);
  const markerIndex = lines.indexOf(`    ${name}:`);
  if (markerIndex < 0) return [];

  const prefix = "      - ";
  const values: string[] = [];
  for (const line of lines.slice(markerIndex + 1)) {
    if (!line.startsWith(prefix)) break;
    values.push(line.slice(prefix.length));
  }
  return values;
}

describe("Mergify integration contract", () => {
  it("requires an explicit maintainer queue admission signal", () => {
    expect(mergify).toContain("label = queue-me");
    expect(mergify).not.toContain("auto-queue release-please");
    expect(mergify).not.toContain("auto-queue Renovate");
    expect(mergify).not.toContain("auto-queue feature PRs");
  });

  it("delegates stable required checks to GitHub ruleset injection", () => {
    expect(stableRequiredChecks.length).toBeGreaterThan(0);
    expect(mergify).toContain("branch_protection_injection_mode: queue");
    for (const check of stableRequiredChecks) {
      expect(mergify).not.toContain(`check-success = ${check}`);
    }
  });

  it("uses serial in-place queue checks with the strict required-check ruleset", () => {
    expect(mergify).toContain("mode: serial");
    expect(mergify).not.toContain("mode: parallel");
    expect(mergify).toContain("max_parallel_checks: 1");
    expect(mergify).toContain("batch_size: 1");
    expect(mergify).toContain("max_checks_retries: 0");
    expect(mergify).toContain("update_method: merge");
    expect(mergify).toContain("checks_timeout: null");
    const statusChecksRule = mainRuleset.rules.find((rule) => rule.type === "required_status_checks");
    expect(statusChecksRule?.parameters?.strict_required_status_checks_policy).toBe(true);
    const queueConditions = readQueueConditionList("queue_conditions");
    const mergeConditions = readQueueConditionList("merge_conditions");
    expect(queueConditions).toEqual(["label = queue-me", "-draft"]);
    expect(mergeConditions).toEqual(queueConditions);
  });

  it("does not use unsupported Mergify condition attributes", () => {
    expect(mergify).not.toContain("#approvals");
    expect(mergify).not.toContain("#comments");
  });

  it("uses unquoted path regex values for file-label rules", () => {
    expect(mergify).toContain("files ~= ^\\.github/workflows/security");
    expect(mergify).toContain("files ~= ^docs/");
    expect(mergify).not.toContain('files ~= "^');
  });

  it("keeps queue scopes in Mergify without replacing the repository CI risk profile", () => {
    expect(mergify).toContain("merge_queue_scope: merge-queue");
    expect(ci).not.toContain("ci / detect-scopes");
    expect(ci).not.toContain("needs.detect-scopes.outputs");
  });

  it("pins every Mergify GitHub Action use to the reviewed v24 commit", () => {
    const actionUses = ci.match(/Mergifyio\/gha-mergify-ci@[^\s]+/gu) ?? [];
    expect(actionUses.length).toBeGreaterThan(0);
    expect(new Set(actionUses)).toEqual(new Set(["Mergifyio/gha-mergify-ci@f16859b8b4496abe98768bed352d5d9c969a2793"]));
  });

  it("keeps unit-test failures visible in logs while preserving JUnit reports", () => {
    const observableUnitCommand = "pnpm run test:unit --reporter=default --reporter=junit --outputFile.junit=junit.xml";
    expect(
      ci.match(new RegExp(observableUnitCommand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")) ?? [],
    ).toHaveLength(2);
    expect(ci).not.toContain("pnpm run test:unit --reporter=junit --outputFile=junit.xml");
  });

  it("keeps test failures authoritative when CI Insights upload is enabled", () => {
    expect(ci).toContain(["test_step_outcome: $", "{{ steps.tests.outcome }}"].join(""));
    expect(ci).toContain("steps.tests.outcome != 'success'");
    expect(ci).toContain("steps.mergify-token.outputs.enabled == 'true'");
  });
});
