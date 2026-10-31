import { describe, expect, it } from "vitest";
import { isValidExportSha256 } from "../../../packages/db/src/data-export-hex-digest.js";

describe("claimed export digest", () => {
  it("accepts only exactly 64 lowercase hexadecimal characters", () => {
    expect(isValidExportSha256("a".repeat(64))).toBe(true);
    expect(isValidExportSha256("0123456789abcdef".repeat(4))).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    {},
    "",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    `${"a".repeat(63)}\n`,
    `${"a".repeat(63)} `,
    "a".repeat(70_000),
  ])("rejects malformed SHA-256 hashes", (value) => {
    expect(isValidExportSha256(value)).toBe(false);
  });
});
