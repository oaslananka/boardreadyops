import { describe, expect, it } from "vitest";
import { buildReadinessCheckOutput, buildReadinessPrComment } from "../../../apps/web/lib/readiness-result-format.js";

describe("readiness result formatting", () => {
  const findings = [
    {
      ruleId: "low.rule",
      severity: "low",
      message: "Low priority",
      path: "board.kicad_pcb",
    },
    {
      ruleId: "error.rule`\nnext",
      severity: "error",
      message: "Unsafe | table\ncontent",
      path: "bad`path\nfile",
    },
    {
      ruleId: "high.rule",
      severity: "high",
      message: "High priority",
    },
  ] as const;

  it("orders findings by severity and sanitizes inline Markdown content", () => {
    const output = buildReadinessCheckOutput({
      status: "completed",
      decision: "fail",
      findings,
      detailsUrl: "https://boardreadyops.test/runs/run-123",
    });

    expect(output.title).toBe("❌ BoardReadyOps release readiness: Fail");
    expect(output.summary.indexOf("error.rule")).toBeLessThan(output.summary.indexOf("high.rule"));
    expect(output.summary.indexOf("high.rule")).toBeLessThan(output.summary.indexOf("low.rule"));
    expect(output.summary).toContain("Unsafe   table content");
    expect(output.summary).not.toContain("Unsafe | table\ncontent");
    expect(output.summary).toContain("Open the hosted run dashboard: https://boardreadyops.test/runs/run-123");
  });

  it("renders a stable marker and bounded highest-priority list for PR upsert", () => {
    const manyFindings = Array.from({ length: 12 }, (_, index) => ({
      ruleId: `rule-${String(index).padStart(2, "0")}`,
      severity: index === 11 ? "error" : "info",
      message: `Finding ${index}`,
    }));

    const comment = buildReadinessPrComment({
      status: "completed",
      decision: "fail",
      findings: manyFindings,
      detailsUrl: "https://boardreadyops.test/runs/run-123",
    });

    expect(comment).toContain("<!-- boardreadyops:release-readiness -->");
    expect(comment).toContain("[Open hosted run dashboard](https://boardreadyops.test/runs/run-123)");
    expect(comment).toContain("- …and 2 more findings.");
    expect(comment.indexOf("rule-11")).toBeLessThan(comment.indexOf("rule-00"));
  });
});
