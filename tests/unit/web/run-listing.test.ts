import { describe, expect, it, vi } from "vitest";

const liveRepositoryIds = vi.hoisted(() => vi.fn(async () => [49301]));
vi.mock("../../../apps/web/lib/live-installation-repositories.js", () => ({
  resolveLiveInstallationRepositoryIds: liveRepositoryIds,
}));
const dbQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
const dbClose = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query: dbQuery, close: dbClose })),
}));

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
  it("applies repository filtering inside the existing installation and grant scoped SQL", async () => {
    const { loadViewerRuns } = await import("../../../apps/web/lib/run-listing.js");
    dbQuery.mockClear();
    dbClose.mockClear();
    const result = await loadViewerRuns(
      { login: "alice", installationIds: [123] },
      { limit: 3, signedManufacturingOnly: true, repository: "owner/hardware" },
      { DATABASE_URL: "postgres://local" },
    );
    expect(result).toEqual({ state: "ok", runs: [], next: undefined });
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("lower(repositories.owner || '/' || repositories.name) = $6::text"),
      [[123], [49301], null, null, 4, "owner/hardware"],
    );
    const sql = String(dbQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("installations.github_installation_id = any($1::bigint[])");
    expect(sql).toContain("repositories.github_repo_id = any($2::bigint[])");
    expect(sql).toContain("signed_manufacturing_export_evidence");
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("returns empty runs when session is undefined or has no installations", async () => {
    const { loadViewerRuns } = await import("../../../apps/web/lib/run-listing.js");
    expect(await loadViewerRuns(undefined)).toEqual({ state: "ok", runs: [], next: undefined });
    expect(await loadViewerRuns({ login: "alice", installationIds: [] })).toEqual({
      state: "ok",
      runs: [],
      next: undefined,
    });
  });

  it("denies the stale run listing when the App grant was removed", async () => {
    const { loadViewerRuns } = await import("../../../apps/web/lib/run-listing.js");
    liveRepositoryIds.mockResolvedValueOnce(null);
    expect(
      await loadViewerRuns({ login: "alice", installationIds: [123] }, {}, { DATABASE_URL: "postgres://local" }),
    ).toEqual({ state: "access-unavailable" });
  });

  it("returns not-configured state when DATABASE_URL is not set", async () => {
    const { loadViewerRuns } = await import("../../../apps/web/lib/run-listing.js");
    expect(await loadViewerRuns({ login: "alice", installationIds: [123] }, {}, {})).toEqual({
      state: "not-configured",
    });
  });
});
