import { describe, expect, it } from "vitest";
import { releaseRunResultSchema } from "../../../packages/contracts/src/index.js";

function validHardwareImpact() {
  return {
    version: 1,
    baseline: { status: "available" as const, sha: "a".repeat(40) },
    candidate: { sha: "b".repeat(40) },
    facts: {
      readiness: {
        previousScore: 82,
        currentScore: 71,
        scoreDelta: -11,
        previousStatus: "ready" as const,
        currentStatus: "at-risk" as const,
        statusChanged: true,
      },
      findings: { added: 2, resolved: 1, addedBlocking: 1, resolvedBlocking: 0 },
      bom: { added: 1, removed: 0, changed: 2, truncated: false },
      manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 1 },
    },
    assessment: {
      materialChange: true,
      riskDirection: "increased" as const,
      affectedDomains: ["readiness", "findings", "bom", "manufacturing"] as const,
    },
    evidence: [
      {
        domain: "findings" as const,
        kind: "finding" as const,
        label: "Added finding: design.board-outline",
        path: "board.kicad_pcb",
        ruleId: "design.board-outline",
        severity: "high",
      },
    ],
  };
}

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
          contentType: "text/html",
        },
      ],
      metrics: { durationMs: 1234, readinessScore: 72 },
      reportLinks: [{ label: "HTML report", url: "https://reports.example.test/run-123/index.html" }],
    });

    expect(result.version).toBe(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.contentType).toBe("text/html");
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
            contentType: "text html",
          },
        ],
        reportLinks: [{ label: "Report", url: "http://reports.example.test/report.html" }],
      }).success,
    ).toBe(false);
  });

  it("accepts bounded hardware impact while keeping old payloads valid", () => {
    expect(
      releaseRunResultSchema.parse({ status: "completed", decision: "pass", findings: [] }).hardwareImpact,
    ).toBeUndefined();

    const parsed = releaseRunResultSchema.parse({
      status: "completed",
      decision: "pass",
      findings: [],
      hardwareImpact: validHardwareImpact(),
    });
    expect(parsed.hardwareImpact?.version).toBe(1);
  });

  it.each([
    ["uppercase base SHA", { baseline: { status: "available", sha: "A".repeat(40) } }],
    ["short candidate SHA", { candidate: { sha: "b".repeat(39) } }],
    ["unknown risk direction", { assessment: { riskDirection: "safer" } }],
    ["unknown domain", { assessment: { affectedDomains: ["firmware"] } }],
    ["unknown evidence kind", { evidence: [{ domain: "findings", kind: "raw", label: "x" }] }],
    ["unexpected nested key", { candidate: { sha: "b".repeat(40), extra: true } }],
  ])("rejects malformed hardware impact: %s", (_label, patch) => {
    const impact = validHardwareImpact() as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      impact[key] =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? { ...(impact[key] ?? {}), ...(value as Record<string, unknown>) }
          : value;
    }
    expect(
      releaseRunResultSchema.safeParse({ status: "completed", decision: "pass", findings: [], hardwareImpact: impact })
        .success,
    ).toBe(false);
  });

  it("rejects evidence and numeric values beyond the bounded hardware impact contract", () => {
    const tooMuchEvidence = validHardwareImpact();
    tooMuchEvidence.evidence = Array.from({ length: 13 }, (_, index) => ({
      domain: "findings" as const,
      kind: "finding" as const,
      label: `finding-${index}`,
      path: `board-${index}.kicad_pcb`,
      ruleId: `rule.${index}`,
      severity: "high",
    }));
    expect(
      releaseRunResultSchema.safeParse({
        status: "completed",
        decision: "pass",
        findings: [],
        hardwareImpact: tooMuchEvidence,
      }).success,
    ).toBe(false);

    for (const impact of [
      { ...validHardwareImpact(), evidence: [{ domain: "findings", kind: "finding", label: "x".repeat(257) }] },
      {
        ...validHardwareImpact(),
        facts: {
          ...validHardwareImpact().facts,
          readiness: { ...validHardwareImpact().facts.readiness, currentScore: 101 },
        },
      },
      {
        ...validHardwareImpact(),
        facts: {
          ...validHardwareImpact().facts,
          findings: { ...validHardwareImpact().facts.findings, added: Number.POSITIVE_INFINITY },
        },
      },
    ]) {
      expect(
        releaseRunResultSchema.safeParse({
          status: "completed",
          decision: "pass",
          findings: [],
          hardwareImpact: impact,
        }).success,
      ).toBe(false);
    }
  });
});

describe("board attribution and BOM rows", () => {
  const base = {
    version: 1 as const,
    status: "completed" as const,
    decision: "pass" as const,
    findings: [],
    artifacts: [],
    metrics: {},
    reportLinks: [],
  };

  it("accepts a payload with no board attribution and leaves the fields absent", () => {
    const parsed = releaseRunResultSchema.parse(base);
    expect(parsed).not.toHaveProperty("boms");
  });

  it("accepts per-board BOM rows and finding project attribution", () => {
    const parsed = releaseRunResultSchema.parse({
      ...base,
      findings: [
        {
          ruleId: "bom.lifecycle",
          severity: "medium",
          message: "U1 lifecycle status is nrnd.",
          path: "hardware/mainboard/mainboard.kicad_pcb",
          project: "hardware/mainboard/mainboard.kicad_pro",
        },
      ],
      boms: [
        {
          project: "hardware/mainboard/mainboard.kicad_pro",
          components: [
            { reference: "U1", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1, dnp: false },
            { reference: "R1", value: "10k", quantity: 4 },
          ],
        },
      ],
    });

    expect(parsed.findings[0]?.project).toBe("hardware/mainboard/mainboard.kicad_pro");
    expect(parsed.boms?.[0]?.components).toHaveLength(2);
    expect(parsed.boms?.[0]?.components[0]?.mpn).toBe("STM32F103C8T6");
  });

  it("rejects a BOM entry with no project attribution", () => {
    expect(() =>
      releaseRunResultSchema.parse({
        ...base,
        boms: [{ components: [{ reference: "U1" }] }],
      }),
    ).toThrow();
  });

  it("rejects a component with no reference", () => {
    expect(() =>
      releaseRunResultSchema.parse({
        ...base,
        boms: [{ project: "board.kicad_pro", components: [{ mpn: "STM32F103C8T6" }] }],
      }),
    ).toThrow();
  });
});
