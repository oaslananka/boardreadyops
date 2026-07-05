import { describe, expect, it } from "vitest";
import { stableComponentKey } from "../../../src/bom/identity.js";
import { normalizeBomRows } from "../../../src/bom/normalizer.js";

describe("stableComponentKey", () => {
  it("produces a 16-hex-character key", () => {
    const key = stableComponentKey("R1", "RC0603FR-0710KL", "Yageo");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    const key1 = stableComponentKey("R1", "RC0603FR-0710KL", "Yageo");
    const key2 = stableComponentKey("r1", " rc0603fr-0710kl ", " yageo ");
    expect(key1).toBe(key2);
  });

  it("differs when reference changes", () => {
    const key1 = stableComponentKey("R1", "ABC", "Yageo");
    const key2 = stableComponentKey("R2", "ABC", "Yageo");
    expect(key1).not.toBe(key2);
  });

  it("differs when mpn changes", () => {
    const key1 = stableComponentKey("R1", "ABC", "Yageo");
    const key2 = stableComponentKey("R1", "DEF", "Yageo");
    expect(key1).not.toBe(key2);
  });

  it("treats undefined mpn and manufacturer as empty strings", () => {
    const key1 = stableComponentKey("R1", undefined, undefined);
    const key2 = stableComponentKey("R1", "", "");
    expect(key1).toBe(key2);
  });
});

describe("normalizeBomRows — provenance tracking", () => {
  it("records provenance for standard column names", () => {
    const rows = normalizeBomRows(
      [{ Reference: "R1", MPN: "ABC123", Manufacturer: "Yageo", Value: "10k", Footprint: "R_0603" }],
      "bom.csv",
    );
    expect(rows).toHaveLength(1);
    const provenance = rows[0]?.provenance ?? [];
    const mpnProv = provenance.find((p) => p.field === "mpn");
    expect(mpnProv?.sourceField).toBe("MPN");
    const mfrProv = provenance.find((p) => p.field === "manufacturer");
    expect(mfrProv?.sourceField).toBe("Manufacturer");
  });

  it("records provenance for aliased column names", () => {
    const rows = normalizeBomRows([{ Refs: "C1", manufacturer_part_number: "CAP-100N", mfr: "Murata" }], "bom.csv");
    expect(rows).toHaveLength(1);
    const provenance = rows[0]?.provenance ?? [];
    const mpnProv = provenance.find((p) => p.field === "mpn");
    expect(mpnProv?.sourceField).toBe("manufacturer_part_number");
    const mfrProv = provenance.find((p) => p.field === "manufacturer");
    expect(mfrProv?.sourceField).toBe("mfr");
  });

  it("populates identityKey for each row", () => {
    const rows = normalizeBomRows([{ Reference: "R1", MPN: "ABC", Manufacturer: "Yageo" }], "bom.csv");
    expect(rows[0]?.identityKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it("identity key is stable regardless of column order", () => {
    const rows1 = normalizeBomRows([{ Reference: "R1", MPN: "ABC", Manufacturer: "Yageo" }], "bom.csv");
    const rows2 = normalizeBomRows([{ Manufacturer: "Yageo", MPN: "ABC", Reference: "R1" }], "bom.csv");
    expect(rows1[0]?.identityKey).toBe(rows2[0]?.identityKey);
  });

  it("expands grouped reference rows with individual identityKeys", () => {
    const rows = normalizeBomRows([{ Reference: "R1,R2,R3", MPN: "ABC", Manufacturer: "Yageo" }], "bom.csv");
    expect(rows).toHaveLength(3);
    const keys = new Set(rows.map((r) => r.identityKey));
    // Each reference gets its own key
    expect(keys.size).toBe(3);
  });

  it("does not include provenance for fields absent from the row", () => {
    const rows = normalizeBomRows([{ Reference: "R1", MPN: "ABC" }], "bom.csv");
    const provenance = rows[0]?.provenance ?? [];
    const mfrProv = provenance.find((p) => p.field === "manufacturer");
    expect(mfrProv).toBeUndefined();
  });
});
