import { describe, expect, it } from "vitest";
import { buildAlternatesMap, hasApprovedAlternates } from "../../../../src/bom/alternates.js";
import { expectRule, runFixture } from "../helpers.js";

describe("bom.single-source", () => {
  it("flags MPNs with only one supplier column populated", async () => {
    const result = await runFixture("bom-single-source");
    const findings = expectRule(result, "bom.single-source", 1);
    expect(findings[0]?.details).toMatchObject({ reference: "R1", supplier: "DigiKey" });
  });

  it("suppresses single-source finding when an approved alternate is configured", async () => {
    const result = await runFixture("bom-single-source", { config: "with-alternates.yml" });
    expectRule(result, "bom.single-source", 0);
  });
});

describe("buildAlternatesMap / hasApprovedAlternates", () => {
  it("builds a case-insensitive lookup map from alternate entries", () => {
    const entries = [
      {
        mpn: "RC0603FR-0710KL",
        alts: [{ mpn: "RMCF0603FT10K0", manufacturer: "Stackpole", note: "drop-in" }],
      },
    ];
    const map = buildAlternatesMap(entries);
    expect(hasApprovedAlternates("RC0603FR-0710KL", map)).toBe(true);
    expect(hasApprovedAlternates("rc0603fr-0710kl", map)).toBe(true);
    expect(hasApprovedAlternates("UNKNOWN_MPN", map)).toBe(false);
  });

  it("ignores entries with empty alts arrays", () => {
    const map = buildAlternatesMap([{ mpn: "EMPTY_MPN", alts: [] }]);
    expect(hasApprovedAlternates("EMPTY_MPN", map)).toBe(false);
  });

  it("trims whitespace from MPN keys", () => {
    const map = buildAlternatesMap([{ mpn: "  SPACED_MPN  ", alts: [{ mpn: "ALT1" }] }]);
    expect(hasApprovedAlternates("SPACED_MPN", map)).toBe(true);
  });
});
