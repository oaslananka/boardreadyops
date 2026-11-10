import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isHistoricalUserUuid } from "../../../packages/db/src/data-export-historical-uuid.js";

describe("original USER UUID boundary", () => {
  it("accepts lowercase canonical UUIDs with any version nibble", () => {
    expect(isHistoricalUserUuid(randomUUID())).toBe(true);
    expect(isHistoricalUserUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isHistoricalUserUuid("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(true);
  });

  it("rejects malformed, coerced and ambiguous identifier text", () => {
    for (const value of [
      null,
      undefined,
      4,
      {},
      [],
      new String("00000000-0000-0000-0000-000000000000"),
      "",
      "a".repeat(36),
      "000000000000-0000-0000-000000000000",
      "00000000-0000-0000-0000-00000000000",
      "00000000-0000-0000-0000-0000000000000",
      "00000000-0000-0000-0000-00000000000G",
      "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
      "00000000-0000-0000-0000-000000000000\n",
      " 00000000-0000-0000-0000-000000000000",
      "00000000-0000-0000-0000-000000000000\0",
      "00000000-0000-0000-0000-0000000000🔒",
    ])
      expect(isHistoricalUserUuid(value)).toBe(false);
  });
});
