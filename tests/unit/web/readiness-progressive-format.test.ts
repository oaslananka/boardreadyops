import { describe, expect, it } from "vitest";
import {
  buildProgressiveReadinessComment,
  buildReadinessPrComment,
} from "../../../apps/web/lib/readiness-result-format.js";

describe("progressive disclosure PR comment formatting", () => {
  const baseInput = {
    status: "completed",
    decision: "fail",
    readiness: {
      score: 45,
      status: "blocked",
      blocking: 2,
      nonBlocking: 1,
      missingRequired: ["gerbers"],
      missingRecommended: [],
      warnings: ["Required gerbers missing"],
    },
    findings: [
      {
        ruleId: "bom.missing-mpn",
        severity: "error",
        message: "Component R1 has no MPN specified.",
        path: "hardware/bom.csv",
      },
      {
        ruleId: "drc.clearance",
        severity: "high",
        message: "Track clearance 0.12mm is below 0.15mm minimum.",
        path: "hardware/board.kicad_pcb",
      },
      {
        ruleId: "silkscreen.clip",
        severity: "low",
        message: "Silkscreen text extends outside board edge.",
        path: "hardware/board.kicad_pcb",
      },
    ],
    artifacts: [
      {
        kind: "gerbers",
        name: "gerbers.zip",
        storagePath: "runs/1/gerbers.zip",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        bytes: 1048576,
        role: "manufacturing",
      },
    ],
    metrics: { durationMs: 4200 },
    reportLinks: [{ label: "HTML Report", url: "https://app.boardreadyops.com/runs/run-123/report" }],
    detailsUrl: "https://app.boardreadyops.com/runs/run-123",
  };

  it("renders a verdict banner with confidence score and executive summary", () => {
    const comment = buildProgressiveReadinessComment(baseInput);

    expect(comment).toContain("## ❌ BoardReadyOps: Release blocked");
    expect(comment).toContain("45/100");
    expect(comment).toContain("<!-- boardreadyops:release-readiness -->");
  });

  it("renders blockers with clear explanation and quick command suggestions", () => {
    const comment = buildProgressiveReadinessComment(baseInput);

    expect(comment).toContain("### Blocking findings");
    expect(comment).toContain("`bom.missing-mpn`");
    expect(comment).toContain('/boardreadyops waive bom.missing-mpn --reason "..."');
    expect(comment).toContain("`drc.clearance`");
  });

  it("renders collapsible details for metrics, artifacts, and slash commands", () => {
    const comment = buildProgressiveReadinessComment(baseInput);

    expect(comment).toContain("<details>");
    expect(comment).toContain("<summary>");
    expect(comment).toContain("</details>");
    expect(comment).toContain("gerbers.zip");
    expect(comment).toContain("/boardreadyops rerun");
    expect(comment).toContain("/boardreadyops help");
  });

  it("includes deep link to web app dashboard", () => {
    const comment = buildProgressiveReadinessComment(baseInput);

    expect(comment).toContain("[Open hosted run dashboard](https://app.boardreadyops.com/runs/run-123)");
  });

  it("preserves standard non-progressive formatting when buildReadinessPrComment is called", () => {
    const standard = buildReadinessPrComment(baseInput);
    expect(standard).not.toContain("<details>");
    expect(standard).toContain("<!-- boardreadyops:release-readiness -->");
  });
});
