import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
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

describe("Mergify integration contract", () => {
  it("uses a manual-only Mergify queue without auto-merge", () => {
    const config = yaml.load(mergify) as {
      merge_queue?: { mode: string; max_parallel_checks: number };
      queue_rules?: Array<{
        name: string;
        merge_method?: string;
        batch_size?: number;
        checks_timeout?: string;
        queue_conditions?: string[];
      }>;
      merge_protections_settings?: Record<string, unknown>;
      pull_request_rules?: Array<{ actions?: Record<string, unknown> }>;
    };

    expect(config.merge_queue).toEqual({ mode: "serial", max_parallel_checks: 1 });
    expect(config).not.toHaveProperty("scopes");
    expect(config.merge_protections_settings).toBeUndefined();
    expect(mergify).not.toContain("auto_merge_conditions");
    expect(mergify).not.toMatch(/\bauto_merge:\s*true\b/u);
    expect(mergify).not.toMatch(/\bautoqueue:\s*true\b/u);

    expect(config.queue_rules).toEqual([
      {
        name: "main",
        merge_method: "squash",
        batch_size: 1,
        checks_timeout: "30 min",
        queue_conditions: ["base = main", "-draft", "check-success = @github-actions/ci / unit-matrix-gate"],
      },
    ]);

    for (const rule of config.pull_request_rules ?? []) {
      expect(rule.actions).not.toHaveProperty("queue");
      expect(rule.actions).not.toHaveProperty("merge");
    }
  });

  it("requires the optional OS/Node matrix through a stable Mergify queue gate", () => {
    const workflow = yaml.load(ci) as {
      jobs: Record<
        string,
        {
          name?: string;
          needs?: string[];
          if?: string;
          steps?: Array<{ env?: Record<string, string>; run?: string }>;
        }
      >;
    };
    const gate = workflow.jobs["unit-matrix-gate"];
    expect(gate?.name).toBe("ci / unit-matrix-gate");
    expect(gate?.needs).toEqual(["risk-profile", "test-unit-matrix"]);
    expect(gate?.if).toContain("always()");
    const enforcement = gate?.steps?.[0];
    expect(enforcement?.env?.MATRIX_REQUIRED).toContain("needs.risk-profile.outputs.needs_unit_matrix");
    expect(enforcement?.env?.MATRIX_RESULT).toContain("needs.test-unit-matrix.result");
    expect(enforcement?.run).toContain('"$MATRIX_RESULT" != "success"');
    expect(enforcement?.run).toContain('"$MATRIX_RESULT" != "skipped"');
    expect(enforcement?.run).toContain('"$PROFILE_RESULT" != "success"');
  });

  it.skipIf(process.platform === "win32")("fails closed on broken or unexpected CI matrix outcomes", () => {
    const workflow = yaml.load(ci) as {
      jobs: Record<string, { steps?: Array<{ run?: string }> }>;
    };
    const script = workflow.jobs["unit-matrix-gate"]?.steps?.[0]?.run;
    expect(script).toBeTruthy();
    const run = (profile: string, required: string, result: string) => {
      execFileSync("bash", ["-c", script ?? "exit 2"], {
        env: {
          ...process.env,
          PROFILE_RESULT: profile,
          MATRIX_REQUIRED: required,
          MATRIX_RESULT: result,
        },
        stdio: "pipe",
      });
    };
    expect(() => run("success", "true", "success")).not.toThrow();
    expect(() => run("success", "false", "skipped")).not.toThrow();
    const rejectedCases: Array<[string, string, string]> = [
      ["success", "true", "failure"],
      ["success", "true", "skipped"],
      ["success", "true", "cancelled"],
      ["success", "false", "success"],
      ["success", "false", "failure"],
      ["success", "", "skipped"],
      ["failure", "false", "skipped"],
    ];
    for (const [profile, required, result] of rejectedCases) {
      expect(() => run(profile, required, result)).toThrow();
    }
  });

  it("keeps GitHub rulesets authoritative for merge gates", () => {
    expect(stableRequiredChecks.length).toBeGreaterThan(0);
    const statusChecksRule = mainRuleset.rules.find((rule) => rule.type === "required_status_checks");
    expect(statusChecksRule?.parameters?.strict_required_status_checks_policy).toBe(true);
    for (const check of stableRequiredChecks) {
      expect(mergify).not.toContain(`check-success = ${check}`);
    }
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

  it("only labels a pull request as documentation when it changes nothing but documentation", () => {
    const config = yaml.load(mergify) as {
      pull_request_rules: Array<{ name: string; conditions: string[] }>;
    };
    const rule = config.pull_request_rules.find((entry) => entry.name === "label documentation changes");
    if (!rule) throw new Error("Expected a documentation labelling rule.");

    // Rule docs under docs/rules/ are generated, so every new-rule pull request touches docs/ as a
    // side effect -- #775 added a manufacturing rule and came out labelled "documentation". The
    // label has to stay docs-only or it stops carrying information.
    expect(rule.conditions).toContain("files ~= ^docs/");
    for (const codePath of ["^src/", "^packages/", "^apps/", "^tests/", "^scripts/"]) {
      expect(rule.conditions, codePath).toContain(`-files ~= ${codePath}`);
    }
  });

  it("does not replace the repository CI risk profile with Mergify scopes", () => {
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
