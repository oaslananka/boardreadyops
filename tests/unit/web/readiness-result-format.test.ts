import { readFile } from "node:fs/promises";
import path from "node:path";
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
      artifacts: [
        {
          kind: "html-report",
          name: "report.html",
          storagePath: "run-123/report.html",
          sha256: "a".repeat(64),
          bytes: 100,
          role: "primary",
        },
      ],
      metrics: { readinessScore: 72, durationMs: 1234 },
      reportLinks: [{ label: String.raw`HTML \[report]`, url: "https://reports.example.test/run(123)/index.html" }],
      detailsUrl: "https://boardreadyops.test/runs/run-123",
    });

    expect(output.title).toBe("❌ BoardReadyOps: Release blocked");
    expect(output.summary.indexOf("error.rule")).toBeLessThan(output.summary.indexOf("high.rule"));
    expect(output.summary.indexOf("high.rule")).toBeLessThan(output.summary.indexOf("low.rule"));
    expect(output.summary).toContain("Unsafe   table content");
    expect(output.summary).not.toContain("Unsafe | table\ncontent");
    expect(output.summary).toContain("**Artifacts:** 1");
    expect(output.summary).toContain("**Reports:** 1");
    expect(output.summary).toContain("**Duration:** 1.2 s");
    expect(output.summary).toContain(
      String.raw`[HTML \\\[report\]](https://reports.example.test/run%28123%29/index.html)`,
    );
    expect(output.summary).toContain("Open the hosted run dashboard: https://boardreadyops.test/runs/run-123");
  });

  it("surfaces the execution trust snapshot and only the restrictions actually enforced", () => {
    const input = {
      status: "completed",
      decision: "pass",
      findings: [],
      artifacts: [],
      trustMode: "safe" as const,
      safeModeReasons: ["private-repository"] as const,
    };

    const output = buildReadinessCheckOutput(input);
    const comment = buildReadinessPrComment(input);

    for (const rendered of [output.summary, comment]) {
      expect(rendered).toContain("Trust mode");
      expect(rendered).toContain("Safe (restricted)");
      expect(rendered).toContain("Private repository");
      expect(rendered).toContain("Managed evidence artifacts unavailable");
      expect(rendered).toContain("safe-mode execution");
      expect(rendered).not.toContain("Network access blocked");
      expect(rendered).not.toContain("Repository secrets blocked");
    }
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
      metrics: { readinessScore: 55 },
      reportLinks: [{ label: "JSON report", url: "https://reports.example.test/run-123/report.json" }],
      detailsUrl: "https://boardreadyops.test/runs/run-123",
    });

    expect(comment).toContain("<!-- boardreadyops:release-readiness -->");
    expect(comment).toContain("[Open hosted run dashboard](https://boardreadyops.test/runs/run-123)");
    expect(comment).toContain("- …and 1 more findings.");
    expect(comment).toContain("### Metrics");
    expect(comment).toContain("[JSON report](https://reports.example.test/run-123/report.json)");
    expect(comment.indexOf("rule-11")).toBeLessThan(comment.indexOf("rule-00"));
  });

  const templateCases = [
    {
      name: "success",
      expectedTitle: "✅ BoardReadyOps: Ready to release",
      input: {
        status: "completed",
        decision: "pass",
        readiness: {
          score: 100,
          status: "ready",
          blocking: 0,
          nonBlocking: 0,
          missingRequired: [],
          missingRecommended: [],
          warnings: [],
        },
        findings: [],
        artifacts: [
          {
            kind: "report/json",
            name: "boardreadyops-result.json",
            storagePath: "run-123/result.json",
            sha256: "a".repeat(64),
            bytes: 4096,
            role: "primary",
          },
        ],
        metrics: { durationMs: 1200 },
        reportLinks: [{ label: "Evidence bundle", url: "https://reports.example.test/run-123" }],
        detailsUrl: "https://boardreadyops.test/runs/run-123",
      },
    },
    {
      name: "warning",
      expectedTitle: "⚠️ BoardReadyOps: Review warnings",
      input: {
        status: "completed",
        decision: "pass",
        readiness: {
          score: 84,
          status: "at-risk",
          blocking: 0,
          nonBlocking: 1,
          missingRequired: [],
          missingRecommended: ["assembly-drawing"],
          warnings: ["Recommended output assembly-drawing is missing."],
        },
        findings: [{ ruleId: "bom.lifecycle", severity: "medium", message: "Lifecycle status needs review." }],
        waivers: {
          active: [
            {
              rule: "bom.lifecycle",
              owner: "hardware-team",
              reason: "Approved for prototype lot.",
              expires: "2026-08-31",
              stale: false,
              expired: false,
              matched: 1,
            },
          ],
          expired: [],
        },
        artifacts: [],
        metrics: { durationMs: 2450 },
        reportLinks: [],
        detailsUrl: "https://boardreadyops.test/runs/run-warning",
      },
    },
    {
      name: "failure",
      expectedTitle: "❌ BoardReadyOps: Release blocked",
      input: {
        status: "completed",
        decision: "fail",
        readiness: {
          score: 42,
          status: "blocked",
          blocking: 1,
          nonBlocking: 1,
          missingRequired: ["gerbers"],
          missingRecommended: [],
          warnings: ["Required output gerbers is missing."],
        },
        findings: [
          { ruleId: "pcb.unrouted", severity: "high", message: "Two tracks remain unrouted.", path: "board.kicad_pcb" },
          { ruleId: "bom.review", severity: "medium", message: "Review the BOM lifecycle state." },
        ],
        waivers: {
          active: [],
          expired: [
            {
              rule: "pcb.unrouted",
              owner: "hardware-team",
              reason: "Prototype exception expired.",
              expires: "2026-07-01",
              stale: false,
              expired: true,
              matched: 1,
            },
          ],
        },
        artifacts: [],
        metrics: { durationMs: 3200 },
        reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-failure" }],
        detailsUrl: "https://boardreadyops.test/runs/run-failure",
      },
    },
    {
      name: "cancelled",
      expectedTitle: "⏹️ BoardReadyOps: Run cancelled",
      input: {
        status: "cancelled",
        decision: null,
        findings: [],
        artifacts: [],
        metrics: {},
        reportLinks: [],
        detailsUrl: "https://boardreadyops.test/runs/run-cancelled",
      },
    },
    {
      name: "timed-out",
      expectedTitle: "⏱️ BoardReadyOps: Run timed out",
      input: {
        status: "timed_out",
        decision: "error",
        findings: [],
        artifacts: [],
        metrics: { durationMs: 900000 },
        reportLinks: [],
        detailsUrl: "https://boardreadyops.test/runs/run-timeout",
      },
    },
    {
      name: "superseded",
      expectedTitle: "🔄 BoardReadyOps: Run superseded",
      input: {
        status: "superseded",
        decision: null,
        findings: [],
        artifacts: [],
        metrics: {},
        reportLinks: [],
        detailsUrl: "https://boardreadyops.test/runs/run-superseded",
      },
    },
  ] as const;

  it.each(templateCases)("renders the $name terminal template from its reviewed fixture", async ({
    name,
    expectedTitle,
    input,
  }) => {
    const output = buildReadinessCheckOutput(input);
    const comment = buildReadinessPrComment(input);
    const fixture = await readFile(path.resolve(`tests/fixtures/web/readiness-comments/${name}.md`), "utf8");

    expect(output.title).toBe(expectedTitle);
    expect(output.summary).toContain("Next steps");
    expect(comment).toBe(fixture);
    expect(comment).toContain("<!-- boardreadyops:release-readiness -->");
  });
});
