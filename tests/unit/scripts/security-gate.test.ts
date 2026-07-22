import { describe, expect, it } from "vitest";
import { evaluateSecurityGate } from "../../../scripts/security-gate.mjs";

type GateInput = Parameters<typeof evaluateSecurityGate>[0];

function passingInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    eventName: "pull_request",
    forkPullRequest: false,
    policy: {
      codeScan: true,
      dependencyScan: true,
      compliance: true,
      sbom: true,
    },
    results: {
      policy: "success",
      codeql: "success",
      semgrep: "success",
      gitleaks: "success",
      dependencyReview: "success",
      osvPullRequest: "success",
      osvFull: "skipped",
      compliance: "success",
      sbom: "success",
    },
    ...overrides,
  };
}

describe("security aggregate gate", () => {
  it("passes when every applicable mandatory check succeeds", () => {
    const result = evaluateSecurityGate(passingInput());

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Security merge gate: passed");
    expect(result.summary).toContain("| CodeQL | Required | success |");
    expect(result.summary).toContain("| OSV dependency diff | Required | success |");
  });

  it.each([
    "failure",
    "cancelled",
    "skipped",
  ] as const)("fails when an applicable scanner result is %s", (scannerResult) => {
    const input = passingInput();
    input.results.semgrep = scannerResult;
    const result = evaluateSecurityGate(input);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(`Semgrep: ${scannerResult}`);
    expect(result.summary).toContain(`| Semgrep | Required | ${scannerResult} |`);
  });

  it("reports policy-approved non-applicable checks instead of silently omitting them", () => {
    const result = evaluateSecurityGate(
      passingInput({
        policy: {
          codeScan: false,
          dependencyScan: false,
          compliance: false,
          sbom: false,
        },
        results: {
          policy: "success",
          codeql: "skipped",
          semgrep: "skipped",
          gitleaks: "success",
          dependencyReview: "skipped",
          osvPullRequest: "skipped",
          osvFull: "skipped",
          compliance: "skipped",
          sbom: "skipped",
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("| CodeQL | Not applicable | skipped |");
    expect(result.summary).toContain("No executable or workflow changes");
    expect(result.summary).toContain("| Gitleaks | Required | success |");
  });

  it("treats CodeQL as explicitly non-applicable for fork pull requests", () => {
    const input = passingInput({ forkPullRequest: true });
    input.results.codeql = "skipped";
    const result = evaluateSecurityGate(input);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Fork pull request uses a read-only token");
    expect(result.summary).toContain("| Semgrep | Required | success |");
    expect(result.summary).toContain("| Gitleaks | Required | success |");
  });

  it("uses the full OSV result outside pull requests", () => {
    const input = passingInput({ eventName: "schedule" });
    input.results.osvPullRequest = "skipped";
    input.results.osvFull = "success";
    const result = evaluateSecurityGate(input);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("| OSV full scan | Required | success |");
    expect(result.summary).not.toContain("OSV dependency diff");
  });

  it("fails closed when the policy classifier does not succeed", () => {
    const input = passingInput();
    input.results.policy = "cancelled";
    const result = evaluateSecurityGate(input);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("Security policy: cancelled");
  });
});
