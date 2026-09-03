import { describe, expect, it } from "vitest";
import { normalizeBomRows } from "../../../src/bom/normalizer.js";
import { HostileInputError } from "../../../src/util/errors.js";

describe("normalizeBomRows hostile input guard", () => {
  it("rejects a BOM with an absurd row count instead of normalizing it", () => {
    const rows = Array.from({ length: 100_001 }, (_, index) => ({ Reference: `R${index}`, MPN: "ABC" }));
    expect(() => normalizeBomRows(rows, "bom.csv")).toThrow(HostileInputError);
  });
});
