import { describe, expect, it } from "vitest";
import { releaseRunResultSchema } from "../../../packages/contracts/src/index.js";

describe("release run result contract", () => {
  it("normalizes the rolling-upgrade payload into contract v1", () => {
    expect(
      releaseRunResultSchema.parse({
        status: "completed",
        decision: "pass",
        findings: [],
      }),
    ).toEqual({
      version: 1,
      status: "completed",
      conclusion: "success",
      decision: "pass",
      findings: [],
      artifacts: [],
      metrics: {},
      reportLinks: [],
    });
  });

  it("accepts bounded artifact metadata, metrics, and HTTPS report links", () => {
    const result = releaseRunResultSchema.parse({
      version: 1,
      executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
      status: "completed",
      conclusion: "failure",
      decision: "fail",
      findings: [{ ruleId: "pcb.unrouted", severity: "error", message: "Two tracks remain unrouted." }],
      artifacts: [
        {
          kind: "html-report",
          name: "boardreadyops-report.html",
          storagePath: "run-123/reports/boardreadyops-report.html",
          sha256: "a".repeat(64),
          bytes: 4096,
          role: "primary",
        },
      ],
      metrics: { durationMs: 1234, readinessScore: 72 },
      reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-123/index.html" }],
    });

    expect(result.version).toBe(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.metrics.readinessScore).toBe(72);
    expect(result.reportLinks[0]?.url).toMatch(/^https:/u);
  });

  it("accepts bounded readiness and waiver context for product-quality GitHub output", () => {
    const result = releaseRunResultSchema.parse({
      status: "completed",
      decision: "pass",
      findings: [],
      readiness: {
        score: 84,
        status: "at-risk",
        blocking: 0,
        nonBlocking: 1,
        missingRequired: [],
        missingRecommended: ["assembly-drawing"],
        warnings: ["Recommended output assembly-drawing is missing."],
      },
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
    });

    expect(result.readiness).toMatchObject({ score: 84, status: "at-risk" });
    expect(result.waivers?.active).toHaveLength(1);
  });

  it("rejects metric maps that exceed the bounded contract", () => {
    const metrics = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`metric-${index}`, index]));

    expect(
      releaseRunResultSchema.safeParse({
        version: 1,
        status: "completed",
        conclusion: "success",
        decision: "pass",
        findings: [],
        metrics,
      }).success,
    ).toBe(false);
  });

  it("rejects inconsistent conclusions and unsafe artifact/report locations", () => {
    expect(
      releaseRunResultSchema.safeParse({
        version: 1,
        status: "completed",
        conclusion: "success",
        decision: "fail",
        findings: [],
      }).success,
    ).toBe(false);

    expect(
      releaseRunResultSchema.safeParse({
        version: 1,
        status: "completed",
        conclusion: "success",
        decision: "pass",
        findings: [],
        artifacts: [
          {
            kind: "report",
            name: "report.html",
            storagePath: "../private/report.html",
            sha256: "b".repeat(64),
            bytes: 10,
            role: "primary",
          },
        ],
        reportLinks: [{ label: "Report", url: "http://reports.example.test/report.html" }],
      }).success,
    ).toBe(false);
  });
});
