import { describe, expect, it } from "vitest";
import {
  decodeRunListingCursor,
  encodeRunListingCursor,
  normalizedRunListingLimit,
} from "../../../apps/web/lib/run-listing.js";

describe("run listing cursor", () => {
  it("round-trips a well-formed cursor", () => {
    const cursor = { startedAt: "2026-08-25T08:00:00.000Z", id: "9e100000-0000-4000-8000-000000000001" };
    expect(decodeRunListingCursor(encodeRunListingCursor(cursor))).toEqual(cursor);
  });

  it("returns undefined for a missing cursor", () => {
    expect(decodeRunListingCursor(null)).toBeUndefined();
  });

  it("returns undefined for a cursor that is not valid base64url JSON", () => {
    expect(decodeRunListingCursor("not-base64url-json")).toBeUndefined();
  });

  it("returns undefined for a cursor missing required fields", () => {
    const malformed = Buffer.from(JSON.stringify({ startedAt: "2026-08-25T08:00:00.000Z" }), "utf8").toString(
      "base64url",
    );
    expect(decodeRunListingCursor(malformed)).toBeUndefined();
  });

  it("returns undefined for a cursor with an unparsable timestamp", () => {
    const malformed = Buffer.from(JSON.stringify({ startedAt: "not-a-date", id: "x" }), "utf8").toString("base64url");
    expect(decodeRunListingCursor(malformed)).toBeUndefined();
  });

  it("returns undefined for a cursor id that is empty or oversized", () => {
    const empty = Buffer.from(JSON.stringify({ startedAt: "2026-08-25T08:00:00.000Z", id: "" }), "utf8").toString(
      "base64url",
    );
    const oversized = Buffer.from(
      JSON.stringify({ startedAt: "2026-08-25T08:00:00.000Z", id: "x".repeat(129) }),
      "utf8",
    ).toString("base64url");
    expect(decodeRunListingCursor(empty)).toBeUndefined();
    expect(decodeRunListingCursor(oversized)).toBeUndefined();
  });
});

describe("run listing page size", () => {
  it("defaults to 25 when absent or not a safe integer", () => {
    expect(normalizedRunListingLimit(undefined)).toBe(25);
    expect(normalizedRunListingLimit(Number.NaN)).toBe(25);
  });

  it("clamps to the [1, 100] range", () => {
    expect(normalizedRunListingLimit(0)).toBe(1);
    expect(normalizedRunListingLimit(-5)).toBe(1);
    expect(normalizedRunListingLimit(1000)).toBe(100);
  });

  it("passes through an in-range value unchanged", () => {
    expect(normalizedRunListingLimit(10)).toBe(10);
  });
});

describe("loadViewerRuns", () => {
  it("returns empty runs when session is undefined or has no installations", async () => {
    const { loadViewerRuns } = await import("../../../apps/web/lib/run-listing.js");
    expect(await loadViewerRuns(undefined)).toEqual({ state: "ok", runs: [], next: undefined });
    expect(await loadViewerRuns({ login: "alice", installationIds: [] })).toEqual({
      state: "ok",
      runs: [],
      next: undefined,
    });
  });

  it("returns not-configured state when DATABASE_URL is not set", async () => {
    const { loadViewerRuns } = await import("../../../apps/web/lib/run-listing.js");
    expect(await loadViewerRuns({ login: "alice", installationIds: [123] }, {}, {})).toEqual({
      state: "not-configured",
    });
  });
});
