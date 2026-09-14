import { describe, expect, it } from "vitest";
import { type RunOutcomeInput, runOutcomeEvent } from "../../../apps/web/lib/run-notifications.js";

function input(overrides: Partial<RunOutcomeInput> = {}): RunOutcomeInput {
  return {
    runId: "run-1",
    installationId: "inst-1",
    repositoryFullName: "acme/gateway",
    pullRequestNumber: 42,
    commitSha: "e93d81b4c0ffee",
    decision: "fail",
    status: "completed",
    findings: [
      { severity: "error", ruleId: "drc.clearance" },
      { severity: "error", ruleId: "drc.clearance" },
      { severity: "critical", ruleId: "bom.missing-mpn" },
      { severity: "warning", ruleId: "design.board-outline" },
      { severity: "info", ruleId: "release.changelog-present" },
    ],
    runUrl: "https://app.example/runs/run-1",
    occurredAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("release run notifications", () => {
  it("announces a blocked board with a per-rule breakdown of what is blocking", () => {
    const event = runOutcomeEvent(input());
    expect(event?.type).toBe("release.blocked");
    expect(event?.headline).toBe("3 blocking findings stop this board from being fabricated");
    expect(event?.details).toEqual([
      "Pull request #42, commit e93d81b",
      "drc.clearance — 2 blocking findings",
      "bom.missing-mpn — 1 blocking finding",
    ]);
    expect(event?.url).toBe("https://app.example/runs/run-1");
  });

  it("counts only blocking severities, so a warning does not read as a blocker", () => {
    const event = runOutcomeEvent(
      input({
        findings: [
          { severity: "warning", ruleId: "x" },
          { severity: "error", ruleId: "y" },
        ],
      }),
    );
    expect(event?.headline).toBe("1 blocking finding stops this board from being fabricated");
  });

  it("says the check could not complete rather than inventing a finding count for an error", () => {
    const event = runOutcomeEvent(input({ decision: "error", findings: [] }));
    expect(event?.headline).toContain("could not complete");
    expect(event?.headline).not.toContain("0 blocking");
  });

  it("announces a passing board as ready", () => {
    const event = runOutcomeEvent(input({ decision: "pass", findings: [] }));
    expect(event?.type).toBe("release.ready");
    expect(event?.headline).toContain("ready to fabricate");
  });

  it("keys the message on the run, so a replayed result is the same news", () => {
    expect(runOutcomeEvent(input())?.dedupeKey).toBe("run:run-1:blocked");
    expect(runOutcomeEvent(input({ runId: "run-2" }))?.dedupeKey).toBe("run:run-2:blocked");
    // A board that fails and is later fixed produces two distinct keys, so both are delivered.
    expect(runOutcomeEvent(input({ decision: "pass" }))?.dedupeKey).toBe("run:run-1:ready");
  });

  it("says nothing about a run that has not finished", () => {
    expect(runOutcomeEvent(input({ status: "running" }))).toBeUndefined();
    expect(runOutcomeEvent(input({ status: "queued" }))).toBeUndefined();
  });

  it("says nothing for a decision the catalogue does not cover", () => {
    expect(runOutcomeEvent(input({ decision: "not_available" }))).toBeUndefined();
    expect(runOutcomeEvent(input({ decision: undefined }))).toBeUndefined();
  });

  it("describes a branch run without inventing a pull request", () => {
    const event = runOutcomeEvent(input({ pullRequestNumber: undefined }));
    expect(event?.details[0]).toBe("Commit e93d81b");
  });

  it("omits the link rather than guessing one when the check run has no details URL", () => {
    expect(runOutcomeEvent(input({ runUrl: undefined }))?.url).toBeUndefined();
  });

  it("attributes findings with no rule id instead of dropping them from the count", () => {
    const event = runOutcomeEvent(input({ findings: [{ severity: "error" }] }));
    expect(event?.headline).toContain("1 blocking finding");
    expect(event?.details).toContain("unattributed — 1 blocking finding");
  });
});
