import { describe, expect, it } from "vitest";
import { isValidExportTimestamp } from "../../../packages/db/src/data-export-timestamp.js";

describe("claimed export timestamp validation", () => {
  it.each([
    "2026-10-01T01:02:03Z",
    "2026-10-01T01:02:03.1Z",
    "2026-10-01T01:02:03.123456Z",
    "2026-10-01T01:02:03+03:00",
    "2026-10-01T01:02:03.123456-03:30",
  ])("accepts supported instants: %s", (value) => {
    expect(isValidExportTimestamp(value)).toBe(true);
  });

  it.each([
    null,
    undefined,
    0,
    {},
    "",
    "2026-10-01",
    "2026-10-01 01:02:03Z",
    "2026-10-01T01:02:03",
    "2026-10-01T01:02:03.Z",
    "2026-10-01T01:02:03.1234567Z",
    "2026-10-01T01:02:03+0300",
    "2026-10-01T01:02:03+03:0a",
    "2026-13-01T01:02:03Z",
    "2026-10-01T01:02:03Z".repeat(10_000),
  ])("rejects malformed or unbounded metadata timestamps", (value) => {
    expect(isValidExportTimestamp(value)).toBe(false);
  });
});
