import { describe, expect, it } from "vitest";
import { type PolicyConfig, validateConfig } from "../../../src/core/config.js";
import type { FindingSummary } from "../../../src/core/findings.js";
import { evaluatePolicy, formatPolicyText, type PolicyInput } from "../../../src/core/policy.js";
import type { ReadinessScore } from "../../../src/core/readiness.js";

function summary(overrides: Partial<FindingSummary> = {}): FindingSummary {
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    maxSeverity: "none",
    failed: false,
    ...overrides,
  };
}

function readiness(overrides: Partial<ReadinessScore> = {}): ReadinessScore {
  return {
    score: 100,
    status: "ready",
    blocking: 0,
    nonBlocking: 0,
    evidence: [],
    missingRequired: [],
    missingRecommended: [],
    warnings: [],
    ...overrides,
  };
}

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return { summary: summary(), ruleIds: [], readiness: readiness(), ...overrides };
}

describe("policy engine", () => {
  it("passes when every rule is satisfied", () => {
    const policy: PolicyConfig = {
      enforce: true,
      rules: [
        { id: "no-high", type: "max-severity", severity: "high" },
        { id: "score", type: "min-readiness-score", score: 80 },
        { id: "outputs", type: "require-required-outputs" },
        { id: "status", type: "require-readiness-status", status: ["ready", "at-risk"] },
        { id: "cap", type: "max-findings", max: 5 },
        { id: "forbid", type: "forbid-rules", rules: ["bom.missing-mpn"] },
      ],
    };
    const result = evaluatePolicy(policy, input({ summary: summary({ total: 2, low: 2, maxSeverity: "low" }) }));
    expect(result.status).toBe("pass");
    expect(result.enforced).toBe(true);
    expect(result.rules.every((rule) => rule.status === "pass")).toBe(true);
  });

  it("fails max-severity, min-readiness-score, required outputs, and forbid-rules cases", () => {
    const policy: PolicyConfig = {
      rules: [
        { id: "no-high", type: "max-severity", severity: "high" },
        { id: "cap", type: "max-findings", max: 1 },
        { id: "score", type: "min-readiness-score", score: 80 },
        { id: "outputs", type: "require-required-outputs" },
        { id: "status", type: "require-readiness-status", status: ["ready"] },
        { id: "forbid", type: "forbid-rules", rules: ["bom.missing-mpn"] },
      ],
    };
    const result = evaluatePolicy(
      policy,
      input({
        summary: summary({ total: 3, critical: 1, high: 1, low: 1, maxSeverity: "critical" }),
        ruleIds: ["bom.missing-mpn", "design.clearance"],
        readiness: readiness({ score: 40, status: "blocked", missingRequired: ["gerber"] }),
      }),
    );
    expect(result.status).toBe("fail");
    const failed = result.rules.filter((rule) => rule.status === "fail").map((rule) => rule.id);
    expect(failed).toEqual(["no-high", "cap", "score", "outputs", "status", "forbid"]);
    expect(result.rules.find((rule) => rule.id === "cap")?.message).toContain("exceed the limit of 1");
  });

  const evalRule = (rule: NonNullable<PolicyConfig["rules"]>, over: Partial<PolicyInput> = {}) =>
    evaluatePolicy({ rules: rule }, input(over)).rules[0];

  it("max-severity counts findings exactly at the threshold and reports an exact message", () => {
    const fail = evalRule([{ id: "sev", type: "max-severity", severity: "high" }], {
      summary: summary({ total: 1, high: 1, maxSeverity: "high" }),
    });
    expect(fail?.status).toBe("fail");
    expect(fail?.message).toBe("1 finding(s) at or above high.");

    const pass = evalRule([{ id: "sev", type: "max-severity", severity: "high" }], {
      summary: summary({ total: 1, medium: 1, maxSeverity: "medium" }),
    });
    expect(pass?.status).toBe("pass");
    expect(pass?.message).toBe("No findings at or above high.");
  });

  it("max-findings treats the limit as inclusive with exact messages", () => {
    const atLimit = evalRule([{ id: "cap", type: "max-findings", max: 2 }], { summary: summary({ total: 2, low: 2 }) });
    expect(atLimit?.status).toBe("pass");
    expect(atLimit?.message).toBe("2 finding(s) within the limit of 2.");

    const over = evalRule([{ id: "cap", type: "max-findings", max: 2 }], { summary: summary({ total: 3, low: 3 }) });
    expect(over?.status).toBe("fail");
    expect(over?.message).toBe("3 finding(s) exceed the limit of 2.");
  });

  it("min-readiness-score treats the minimum as inclusive with exact messages", () => {
    const atMin = evalRule([{ id: "s", type: "min-readiness-score", score: 80 }], {
      readiness: readiness({ score: 80 }),
    });
    expect(atMin?.status).toBe("pass");
    expect(atMin?.message).toBe("Readiness score 80 meets the minimum of 80.");

    const below = evalRule([{ id: "s", type: "min-readiness-score", score: 80 }], {
      readiness: readiness({ score: 79 }),
    });
    expect(below?.status).toBe("fail");
    expect(below?.message).toBe("Readiness score 79 is below the minimum of 80.");
  });

  it("require-readiness-status reports allowed and disallowed statuses exactly", () => {
    const allowed = evalRule([{ id: "st", type: "require-readiness-status", status: ["ready", "at-risk"] }], {
      readiness: readiness({ status: "at-risk" }),
    });
    expect(allowed?.message).toBe("Readiness status at-risk is allowed.");

    const disallowed = evalRule([{ id: "st", type: "require-readiness-status", status: ["ready"] }], {
      readiness: readiness({ status: "blocked" }),
    });
    expect(disallowed?.message).toBe("Readiness status blocked is not in [ready].");
  });

  it("require-required-outputs reports the missing outputs exactly", () => {
    const present = evalRule([{ id: "o", type: "require-required-outputs" }], { readiness: readiness() });
    expect(present?.message).toBe("All required outputs are present.");

    const missing = evalRule([{ id: "o", type: "require-required-outputs" }], {
      readiness: readiness({ missingRequired: ["drill", "gerber"] }),
    });
    expect(missing?.status).toBe("fail");
    expect(missing?.message).toBe("Missing required outputs: drill, gerber.");
  });

  it("forbid-rules reports the offending rule ids exactly", () => {
    const clean = evalRule([{ id: "f", type: "forbid-rules", rules: ["bom.eol"] }], { ruleIds: ["design.clearance"] });
    expect(clean?.message).toBe("No forbidden rules produced findings.");

    const hit = evalRule([{ id: "f", type: "forbid-rules", rules: ["bom.eol"] }], { ruleIds: ["bom.eol", "x"] });
    expect(hit?.status).toBe("fail");
    expect(hit?.message).toBe("Forbidden rules present: bom.eol.");
  });

  it("forbid-expired-waivers reports the expired count exactly", () => {
    const none = evalRule([{ id: "w", type: "forbid-expired-waivers" }], { expiredWaivers: 0 });
    expect(none?.message).toBe("No expired waivers.");

    const some = evalRule([{ id: "w", type: "forbid-expired-waivers" }], { expiredWaivers: 3 });
    expect(some?.status).toBe("fail");
    expect(some?.message).toBe("3 expired waiver(s) require renewal or removal.");
  });

  it("forbid-stale-waivers reports the stale count exactly", () => {
    const none = evalRule([{ id: "stale-waivers", type: "forbid-stale-waivers" }], { staleWaivers: 0 });
    expect(none?.message).toBe("No stale waivers.");

    const some = evalRule([{ id: "stale-waivers", type: "forbid-stale-waivers" }], { staleWaivers: 2 });
    expect(some?.status).toBe("fail");
    expect(some?.message).toBe("2 stale waiver(s) no longer match any finding.");
  });

  it("fails readiness-dependent rules when no readiness score is available", () => {
    const policy: PolicyConfig = {
      rules: [
        { id: "score", type: "min-readiness-score", score: 80 },
        { id: "status", type: "require-readiness-status", status: ["ready"] },
        { id: "outputs", type: "require-required-outputs" },
      ],
    };
    const result = evaluatePolicy(policy, { summary: summary(), ruleIds: [], readiness: undefined });
    expect(result.status).toBe("fail");
    const statusRule = result.rules.find((rule) => rule.id === "status");
    expect(statusRule?.status).toBe("fail");
    expect(statusRule?.message).toContain("No readiness status");
    // missing readiness => score treated as 0 (below 80) and no outputs known => required outputs pass
    expect(result.rules.find((rule) => rule.id === "score")?.status).toBe("fail");
    expect(result.rules.find((rule) => rule.id === "outputs")?.status).toBe("pass");
  });

  it("uses rule defaults when optional fields are omitted", () => {
    const policy: PolicyConfig = {
      rules: [
        { id: "sev", type: "max-severity" }, // defaults to high
        { id: "cap", type: "max-findings" }, // defaults to 0
        { id: "score", type: "min-readiness-score" }, // defaults to 0
        { id: "status", type: "require-readiness-status" }, // defaults to [ready]
        { id: "forbid", type: "forbid-rules" }, // defaults to []
      ],
    };
    const result = evaluatePolicy(
      policy,
      input({ summary: summary({ total: 0, maxSeverity: "none" }), readiness: readiness() }),
    );
    expect(result.status).toBe("pass");
  });

  it("fails forbid-expired-waivers when expired waivers exist and passes otherwise", () => {
    const policy: PolicyConfig = { rules: [{ id: "waivers", type: "forbid-expired-waivers" }] };
    expect(evaluatePolicy(policy, { summary: summary(), ruleIds: [], expiredWaivers: 2 }).status).toBe("fail");
    expect(evaluatePolicy(policy, { summary: summary(), ruleIds: [], expiredWaivers: 0 }).status).toBe("pass");
    expect(evaluatePolicy(policy, { summary: summary(), ruleIds: [] }).status).toBe("pass");
  });

  it("fails forbid-stale-waivers when stale waivers exist and passes otherwise", () => {
    const policy: PolicyConfig = { rules: [{ id: "waivers", type: "forbid-stale-waivers" }] };
    expect(evaluatePolicy(policy, { summary: summary(), ruleIds: [], staleWaivers: 2 }).status).toBe("fail");
    expect(evaluatePolicy(policy, { summary: summary(), ruleIds: [], staleWaivers: 0 }).status).toBe("pass");
    expect(evaluatePolicy(policy, { summary: summary(), ruleIds: [] }).status).toBe("pass");
  });

  it("requires actual independently verified source-bound export proof when configured", () => {
    const rule: PolicyConfig = {
      enforce: true,
      rules: [{ id: "signed-fabrication", type: "require-source-bound-export" }],
    };
    const missing = evaluatePolicy(rule, input());
    expect(missing.status).toBe("fail");
    expect(missing.enforced).toBe(true);
    const local = evaluatePolicy(
      rule,
      input({ sourceBound: { status: "byte-consistent-only", reason: "unsigned local manifest" } }),
    );
    expect(local.status).toBe("fail");
    expect(local.rules[0]?.message).toContain("Byte-consistent only");
    const invalid = evaluatePolicy(
      rule,
      input({ sourceBound: { status: "source-bound-verified", reason: "incomplete", sourceSha: "a".repeat(40) } }),
    );
    expect(invalid.status).toBe("fail");
    const evidence = {
      status: "source-bound-verified" as const,
      reason: "verified cryptographically",
      sourceSha: "a".repeat(40),
      runInvocationURI: "https://github.com/customer/board/actions/runs/123/attempts/1",
      subjects: 27,
    };
    const valid = evaluatePolicy(rule, input({ sourceBound: evidence }));
    expect(valid.status).toBe("pass");
    expect(valid.sourceBound).toEqual(evidence);
    expect(formatPolicyText(valid)).toContain("SOURCE-BOUND VERIFIED");
    expect(valid.rules[0]?.message).toContain("27 signed subject");
  });

  it("treats an empty policy as a pass", () => {
    expect(evaluatePolicy({ rules: [] }, input()).status).toBe("pass");
    expect(evaluatePolicy({}, input()).enforced).toBe(false);
  });

  it("renders a readable policy summary", () => {
    const result = evaluatePolicy(
      { enforce: true, rules: [{ id: "no-high", type: "max-severity", severity: "high" }] },
      input({ summary: summary({ total: 1, high: 1, maxSeverity: "high" }) }),
    );
    const text = formatPolicyText(result);
    expect(text).toContain("Policy: FAIL (enforced)");
    expect(text).toContain("FAIL no-high:");
  });

  it("renders an advisory passing policy summary", () => {
    const result = evaluatePolicy(
      { rules: [{ id: "no-high", type: "max-severity", severity: "high" }] },
      input({ summary: summary() }),
    );
    const text = formatPolicyText(result);
    expect(text).toContain("Policy: PASS (advisory)");
    expect(text).toContain("PASS no-high:");
  });

  it("validates the policy configuration schema", () => {
    expect(
      validateConfig({
        version: 1,
        policy: {
          enforce: true,
          rules: [
            { id: "no-high", type: "max-severity", severity: "high" },
            { id: "score", type: "min-readiness-score", score: 80 },
          ],
        },
      }),
    ).toEqual([]);

    expect(
      validateConfig({ version: 1, policy: { rules: [{ id: "signed", type: "require-source-bound-export" }] } }),
    ).toEqual([]);
    expect(validateConfig({ version: 1, policy: { rules: [{ id: "bad", type: "not-a-type" }] } }).join("\n")).toContain(
      "must be equal to one of the allowed values",
    );
  });
});
