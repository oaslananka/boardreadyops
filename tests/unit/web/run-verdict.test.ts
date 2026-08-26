import { describe, expect, it } from "vitest";
import { runVerdict, type VerdictRun } from "../../../apps/web/lib/run-verdict.js";

function run(overrides: Partial<VerdictRun> = {}): VerdictRun {
  return {
    id: "run-1",
    status: "completed",
    decision: "pass",
    conclusion: "success",
    commitSha: "abc1234def5678",
    investigationState: "settled",
    findings: [],
    ...overrides,
  };
}

function finding(severity: string, message: string, waivedAt?: string) {
  return { severity, message, waivedAt };
}

describe("run verdict", () => {
  it("says a clean run is ready, naming the commit", () => {
    const verdict = runVerdict(run());

    expect(verdict.tone).toBe("success");
    expect(verdict.headline).toBe("Ready to fabricate");
    expect(verdict.detail).toContain("abc1234");
  });

  it("names the blocking finding rather than counting rows", () => {
    const verdict = runVerdict(
      run({
        decision: "fail",
        conclusion: "failure",
        findings: [finding("high", "Clearance between GND and VBUS is 4 mil, below the 6 mil rule")],
      }),
    );

    expect(verdict.tone).toBe("danger");
    expect(verdict.headline).toBe("Not ready to fabricate");
    // A count tells somebody how much reading they have; the reason tells them whether they
    // already know what it is.
    expect(verdict.detail).toContain("Clearance between GND and VBUS");
    // Pre-filtered to what is open and sorted worst-first, so the link lands on the reason.
    expect(verdict.action?.href).toBe("/runs/run-1/findings?findingState=active&findingSort=severity");
  });

  it("mentions the remaining blockers after naming the first", () => {
    const verdict = runVerdict(
      run({
        decision: "fail",
        findings: [
          finding("critical", "Unrouted net VCC"),
          finding("high", "Silkscreen over pad"),
          finding("error", "Hole too small"),
        ],
      }),
    );

    expect(verdict.detail).toContain("Unrouted net VCC");
    expect(verdict.detail).toContain("2 other blocking issues");
  });

  it("uses the singular for exactly one other blocker", () => {
    const verdict = runVerdict(
      run({ decision: "fail", findings: [finding("high", "First"), finding("high", "Second")] }),
    );

    expect(verdict.detail).toContain("1 other blocking issue.");
  });

  it("ignores waived findings when describing a pass", () => {
    const verdict = runVerdict(
      run({ findings: [finding("critical", "Accepted long ago", "2026-01-01T00:00:00.000Z")] }),
    );

    // A waived finding is a decision somebody already made; mentioning it would undo them.
    expect(verdict.headline).toBe("Ready to fabricate");
    expect(verdict.detail).toContain("Every check passed");
  });

  it("never overrides a recorded pass using raw severities", () => {
    // A repository whose threshold sits above high can pass with high findings recorded. The
    // policy engine already applied that threshold and the waivers; re-deriving a verdict from
    // severities here would call a board unfit that its own policy passed.
    const verdict = runVerdict(
      run({ decision: "pass", conclusion: "success", findings: [finding("high", "Populated part has no MPN")] }),
    );

    expect(verdict.tone).toBe("success");
    expect(verdict.headline).toBe("Ready to fabricate");
    // Understating it would be the opposite error, so the weight is still named.
    expect(verdict.detail).toContain("1 high-severity finding is recorded");
  });

  it("names several high-severity findings that a pass carried", () => {
    const verdict = runVerdict(run({ findings: [finding("high", "One"), finding("critical", "Two")] }));

    expect(verdict.detail).toContain("2 high-severity findings are recorded");
  });

  it("counts advisory findings as worth a look when nothing is heavier", () => {
    const verdict = runVerdict(run({ findings: [finding("low", "Reference designator overlaps")] }));

    expect(verdict.tone).toBe("success");
    expect(verdict.detail).toContain("1 thing worth a look");
    expect(verdict.action?.label).toBe("Review 1 finding");
  });

  it("refuses to call a run that produced no result a pass", () => {
    const verdict = runVerdict(run({ status: "failed", decision: undefined, conclusion: undefined }));

    // Reporting an unchecked board as ready is the worst thing this product can do.
    expect(verdict.tone).toBe("danger");
    expect(verdict.headline).toBe("Could not check this board");
    expect(verdict.detail).toContain("without producing a result");
  });

  it("distinguishes running out of time from ending early", () => {
    const verdict = runVerdict(run({ status: "timed_out", decision: undefined, conclusion: undefined }));

    expect(verdict.detail).toContain("ran out of time");
  });

  it("says a run still in flight is not decided yet", () => {
    for (const status of ["queued", "dispatched", "running"]) {
      const verdict = runVerdict(run({ status, decision: undefined, conclusion: undefined }));

      expect(verdict.tone).toBe("info");
      expect(verdict.headline).toBe("Still checking");
    }
  });

  it("treats an unsettled investigation as still checking even when the status looks final", () => {
    const verdict = runVerdict(run({ investigationState: "current" }));

    // Saying "ready" about something that is still converging would change under the reader.
    expect(verdict.headline).toBe("Still checking");
  });

  it("asks for a human on a neutral result rather than guessing either way", () => {
    const verdict = runVerdict(run({ decision: "neutral", conclusion: "neutral" }));

    expect(verdict.tone).toBe("warning");
    expect(verdict.headline).toBe("Needs a look");
  });

  it("trims a rule message down to something that reads as a sentence", () => {
    const verdict = runVerdict(
      run({ decision: "fail", findings: [finding("high", "  Trailing punctuation and   spacing.  ")] }),
    );

    expect(verdict.detail).toBe("Trailing punctuation and spacing.");
  });

  it("truncates a very long rule message instead of overflowing the headline", () => {
    const verdict = runVerdict(run({ decision: "fail", findings: [finding("high", "x".repeat(400))] }));

    expect(verdict.detail.length).toBeLessThan(130);
    expect(verdict.detail).toContain("…");
  });

  it("still says something useful when the rule message is empty", () => {
    const verdict = runVerdict(run({ decision: "fail", findings: [finding("high", "   ")] }));

    // A blank message is a rule-authoring bug, not a reason to render an empty sentence.
    expect(verdict.detail).toBe("The policy for this repository rejected the result.");
  });
});
