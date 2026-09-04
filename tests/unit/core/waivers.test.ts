import { describe, expect, it } from "vitest";
import { validateConfig, type WaiverConfig } from "../../../src/core/config.js";
import { createFinding, type Finding } from "../../../src/core/findings.js";
import { applyWaivers } from "../../../src/core/waivers.js";

function finding(ruleId: string, resourcePath = "board.kicad_pcb"): Finding {
  return createFinding({
    ruleId,
    severity: "high",
    message: `${ruleId} finding`,
    resource: { path: resourcePath, kind: "pcb" },
  });
}

const now = new Date("2026-06-22T00:00:00.000Z");

describe("waivers", () => {
  it("returns findings unchanged when no waivers are configured", () => {
    const findings = [finding("bom.missing-mpn")];
    const result = applyWaivers(findings, [], now);
    expect(result.findings).toBe(findings);
    expect(result.active).toEqual([]);
    expect(result.expired).toEqual([]);
    expect(result.falsePositiveSignals).toEqual([]);
  });

  it("records a false-positive telemetry signal when a waiver reason reads as a false positive", () => {
    const target = finding("manufacturing.dfm-pin1-markers");
    const waivers: WaiverConfig[] = [
      {
        rule: "manufacturing.dfm-pin1-markers",
        owner: "alice",
        reason: "False positive: library footprint already includes a pin-1 marker.",
      },
    ];
    const result = applyWaivers([target], waivers, now);

    expect(result.findings[0]?.suppressed).toBe(true);
    expect(result.falsePositiveSignals).toEqual([
      {
        ruleId: "manufacturing.dfm-pin1-markers",
        findingFingerprint: target.fingerprint,
        reason: "False positive: library footprint already includes a pin-1 marker.",
      },
    ]);
  });

  it("does not record a false-positive signal for an ordinary accepted-risk waiver", () => {
    const target = finding("bom.missing-mpn");
    const waivers: WaiverConfig[] = [{ rule: "bom.missing-mpn", owner: "alice", reason: "accepted risk for v1" }];
    const result = applyWaivers([target], waivers, now);

    expect(result.findings[0]?.suppressed).toBe(true);
    expect(result.falsePositiveSignals).toEqual([]);
  });

  it("does not record a false-positive signal for an expired waiver", () => {
    const target = finding("bom.missing-mpn");
    const waivers: WaiverConfig[] = [
      { rule: "bom.missing-mpn", owner: "alice", reason: "false-positive", expires: "2026-01-01" },
    ];
    const result = applyWaivers([target], waivers, now);

    expect(result.findings[0]?.suppressed).toBeUndefined();
    expect(result.falsePositiveSignals).toEqual([]);
  });

  it("suppresses matching findings for an active waiver and counts matches", () => {
    const findings = [finding("bom.missing-mpn"), finding("design.clearance")];
    const waivers: WaiverConfig[] = [
      { rule: "bom.missing-mpn", owner: "alice", reason: "accepted risk", expires: "2026-12-31" },
    ];
    const result = applyWaivers(findings, waivers, now);

    expect(result.findings.find((f) => f.ruleId === "bom.missing-mpn")?.suppressed).toBe(true);
    expect(result.findings.find((f) => f.ruleId === "design.clearance")?.suppressed).toBeUndefined();
    expect(result.active).toHaveLength(1);
    expect(result.active[0]).toMatchObject({ rule: "bom.missing-mpn", owner: "alice", expired: false, matched: 1 });
    expect(result.expired).toEqual([]);
  });

  it("detects expired waivers and does not suppress their findings", () => {
    const findings = [finding("bom.missing-mpn")];
    const waivers: WaiverConfig[] = [
      { rule: "bom.missing-mpn", owner: "bob", reason: "temporary", expires: "2026-01-01" },
    ];
    const result = applyWaivers(findings, waivers, now);

    expect(result.findings[0]?.suppressed).toBeUndefined();
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0]).toMatchObject({ rule: "bom.missing-mpn", expired: true, matched: 1 });
    expect(result.active).toEqual([]);
  });

  it("treats a waiver without an expiry as always active", () => {
    const result = applyWaivers(
      [finding("bom.missing-mpn")],
      [{ rule: "bom.missing-mpn", owner: "carol", reason: "ok" }],
      now,
    );
    expect(result.active[0]?.expires).toBeUndefined();
    expect(result.active[0]?.expired).toBe(false);
    expect(result.findings[0]?.suppressed).toBe(true);
  });

  it("scopes waivers by fingerprint and project", () => {
    const target = finding("bom.missing-mpn", "boards/main/board.kicad_pcb");
    const other = finding("bom.missing-mpn", "boards/aux/board.kicad_pcb");
    const fingerprintWaiver = applyWaivers(
      [target, other],
      [{ rule: "bom.missing-mpn", owner: "a", reason: "r", fingerprint: target.fingerprint }],
      now,
    );
    expect(fingerprintWaiver.findings.filter((f) => f.suppressed)).toHaveLength(1);

    const projectWaiver = applyWaivers(
      [target, other],
      [{ rule: "bom.missing-mpn", owner: "a", reason: "r", project: "boards/main" }],
      now,
    );
    expect(projectWaiver.findings.find((f) => f.resource.path === "boards/main/board.kicad_pcb")?.suppressed).toBe(
      true,
    );
    expect(
      projectWaiver.findings.find((f) => f.resource.path === "boards/aux/board.kicad_pcb")?.suppressed,
    ).toBeUndefined();
  });

  it("marks fingerprint-scoped active waivers as stale when they no longer match findings", () => {
    const result = applyWaivers(
      [finding("bom.missing-mpn")],
      [
        {
          rule: "bom.missing-mpn",
          owner: "alice",
          reason: "accepted risk",
          fingerprint: "0".repeat(64),
          approvedBy: "lead-reviewer",
          evidence: "https://example.invalid/review/123",
        },
      ],
      now,
    );

    expect(result.active[0]).toMatchObject({
      approvedBy: "lead-reviewer",
      evidence: "https://example.invalid/review/123",
      expired: false,
      matched: 0,
      stale: true,
    });
    expect(result.findings[0]?.suppressed).toBeUndefined();
  });

  it("requires rule, owner, and reason in the configuration schema", () => {
    expect(
      validateConfig({
        version: 1,
        waivers: [
          {
            rule: "bom.missing-mpn",
            owner: "alice",
            reason: "accepted",
            approvedBy: "lead-reviewer",
            evidence: "https://example.invalid/review/123",
          },
        ],
      }),
    ).toEqual([]);
    expect(validateConfig({ version: 1, waivers: [{ rule: "bom.missing-mpn" }] }).join("\n")).toContain(
      "must have required property",
    );
  });
});
