import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { WaiverConfig } from "../../src/core/config.js";
import { createFinding, type Finding } from "../../src/core/findings.js";
import { applyWaivers } from "../../src/core/waivers.js";

function finding(ruleId: string, fingerprint?: string, resourcePath = "board.kicad_pcb"): Finding {
  return createFinding({
    ruleId,
    severity: "high",
    message: `${ruleId} finding`,
    resource: { path: resourcePath, kind: "pcb" },
    ...(fingerprint === undefined ? {} : { fingerprint }),
  });
}

const isoDate = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z"), noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10));

describe("applyWaivers properties", () => {
  it("is deterministic for the same inputs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 })),
        fc.array(fc.record({ rule: fc.string({ minLength: 1 }), owner: fc.string(), reason: fc.string() })),
        isoDate,
        (ruleIds, waiverInputs, now) => {
          const findings = ruleIds.map((ruleId, index) => finding(`${ruleId}-${index}`));
          const waivers: WaiverConfig[] = waiverInputs;
          const nowDate = new Date(`${now}T00:00:00.000Z`);
          expect(applyWaivers(findings, waivers, nowDate)).toEqual(applyWaivers(findings, waivers, nowDate));
        },
      ),
    );
  });

  it("partitions every waiver into exactly one of active or expired", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ rule: fc.string({ minLength: 1 }), owner: fc.string(), reason: fc.string() })),
        isoDate,
        (waiverInputs, now) => {
          const waivers: WaiverConfig[] = waiverInputs;
          const result = applyWaivers([], waivers, new Date(`${now}T00:00:00.000Z`));
          expect(result.active.length + result.expired.length).toBe(waivers.length);
        },
      ),
    );
  });

  it("preserves finding count and order, only ever adding a suppressed flag", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        fc.array(fc.record({ rule: fc.string({ minLength: 1 }), owner: fc.string(), reason: fc.string() })),
        isoDate,
        (ruleIds, waiverInputs, now) => {
          const findings = ruleIds.map((ruleId, index) => finding(`${ruleId}-${index}`));
          const result = applyWaivers(findings, waiverInputs, new Date(`${now}T00:00:00.000Z`));
          expect(result.findings).toHaveLength(findings.length);
          result.findings.forEach((f, index) => {
            expect(f.fingerprint).toBe(findings[index]?.fingerprint);
            expect(f.ruleId).toBe(findings[index]?.ruleId);
          });
        },
      ),
    );
  });

  it("never suppresses a finding whose only match is an expired waiver", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), fc.string(), isoDate, (rule, owner, reason, expires) => {
        const f = finding(rule);
        const now = new Date(`${expires}T00:00:00.000Z`);
        now.setUTCDate(now.getUTCDate() + 1); // strictly after expires, so the waiver is expired
        const result = applyWaivers([f], [{ rule, owner, reason, expires }], now);
        expect(result.findings[0]?.suppressed).toBeUndefined();
        expect(result.expired).toHaveLength(1);
        expect(result.expired[0]?.matched).toBe(1);
        expect(result.active).toEqual([]);
      }),
    );
  });

  it("treats a waiver with no expires as active for any evaluation date", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), fc.string(), isoDate, (rule, owner, reason, now) => {
        const result = applyWaivers([finding(rule)], [{ rule, owner, reason }], new Date(`${now}T00:00:00.000Z`));
        expect(result.active).toHaveLength(1);
        expect(result.active[0]?.expired).toBe(false);
        expect(result.expired).toEqual([]);
      }),
    );
  });

  it("once a waiver is expired at some date, it stays expired at every later date", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        fc.string(),
        isoDate,
        fc.integer({ min: 0, max: 3650 }),
        fc.integer({ min: 1, max: 3650 }),
        (rule, owner, reason, expires, daysAfterFirst, extraDays) => {
          const first = new Date(`${expires}T00:00:00.000Z`);
          first.setUTCDate(first.getUTCDate() + daysAfterFirst);
          const later = new Date(first);
          later.setUTCDate(later.getUTCDate() + extraDays);

          const waivers: WaiverConfig[] = [{ rule, owner, reason, expires }];
          const firstResult = applyWaivers([], waivers, first);
          if (firstResult.expired.length === 1) {
            const laterResult = applyWaivers([], waivers, later);
            expect(laterResult.expired).toHaveLength(1);
          }
        },
      ),
    );
  });

  it("matches a fingerprint-scoped waiver regardless of the configured fingerprint's letter case", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), fc.string(), (rule, owner, reason) => {
        const fp = "abc123def456";
        const f = finding(rule, fp);
        const now = new Date("2026-06-22T00:00:00.000Z");
        const result = applyWaivers(
          [f],
          [{ rule, owner, reason, fingerprint: fp.toUpperCase(), expires: "2099-01-01" }],
          now,
        );
        expect(result.findings[0]?.suppressed).toBe(true);
        expect(result.active[0]?.matched).toBe(1);
      }),
    );
  });
});
